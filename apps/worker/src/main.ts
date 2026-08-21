import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { GeminiProvider } from "@bots/core";
import postgres from "postgres";
import { processJob, type Job } from "./job.js";

/**
 * SQS consumer.
 *
 * Deliberately thin: all the work is in `processJob`, which is tested directly.
 * This file is the part that cannot be unit-tested usefully — polling, acking,
 * and knowing when NOT to ack.
 */

const QUEUE_URL = process.env.INGEST_QUEUE_URL;
const BUCKET = process.env.INGEST_BUCKET;

async function main(): Promise<void> {
  if (!QUEUE_URL) throw new Error("INGEST_QUEUE_URL is not set.");

  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 4 });
  const sqs = new SQSClient({});
  const s3 = new S3Client({});
  const provider = new GeminiProvider();

  const getObject = async (key: string) => {
    if (!BUCKET) throw new Error("INGEST_BUCKET is not set.");
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const body = Buffer.from(await res.Body!.transformToByteArray());
    return { body, contentType: res.ContentType ?? "application/octet-stream" };
  };

  let running = true;
  const stop = () => {
    running = false;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  console.log("[worker] polling", QUEUE_URL);
  while (running) {
    const res = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 1,
        // Long poll: one request per 20s of idle instead of one per loop.
        WaitTimeSeconds: 20,
        // Ingest of a large PDF takes minutes; a short visibility timeout would
        // hand the same job to a second worker while the first is still on it.
        VisibilityTimeout: 900,
      }),
    );

    for (const message of res.Messages ?? []) {
      let job: Job;
      try {
        job = JSON.parse(message.Body ?? "{}") as Job;
      } catch {
        // Unparseable: acking sends it away for good, which is right — retrying
        // malformed JSON produces the same malformed JSON. The DLQ is for work
        // that could succeed later.
        console.error("[worker] dropping unparseable message", message.MessageId);
        await sqs.send(new DeleteMessageCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: message.ReceiptHandle! }));
        continue;
      }

      try {
        const result = await processJob(job, { sql, provider, getObject });
        console.log("[worker] done", job.kind, result);
        await sqs.send(new DeleteMessageCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: message.ReceiptHandle! }));
      } catch (err) {
        // NOT acked on purpose — the message returns to the queue and, after the
        // redrive policy's attempts, lands in the DLQ where it can be inspected.
        console.error("[worker] job failed, leaving for redrive:", err);
      }
    }
  }

  console.log("[worker] draining");
  await sql.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
