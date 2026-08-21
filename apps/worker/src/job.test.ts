import { FakeProvider } from "@bots/rag/testing";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { processJob, type Job, type JobDeps } from "./job.js";

/** Job handling against a real Postgres. Model and S3 are stand-ins. */

const URL_ = process.env.MIGRATION_DATABASE_URL ?? "postgres://bots:bots@localhost:5433/bots";
const RUN = Math.random().toString(36).slice(2, 10);

let sql: postgres.Sql;
let orgId: string;
let botId: string;
let deps: JobDeps;
const fake = new FakeProvider();

const objects = new Map<string, { body: Buffer; contentType: string }>();

beforeAll(async () => {
  sql = postgres(URL_, { max: 4 });
  const [org] = await sql`INSERT INTO organizations (name) VALUES (${`worker-${RUN}`}) RETURNING id`;
  orgId = org!.id;
  const [bot] = await sql`
    INSERT INTO bots (org_id, name, public_key) VALUES (${orgId}, 'W', ${`pb_live_w_${RUN}`}) RETURNING id`;
  botId = bot!.id;
  deps = {
    sql,
    provider: fake,
    getObject: async (key) => {
      const o = objects.get(key);
      if (!o) throw new Error(`no such object: ${key}`);
      return o;
    },
    contextualize: false,
  };
});

afterAll(async () => {
  if (sql && orgId) await sql`DELETE FROM organizations WHERE id = ${orgId}`;
  await sql?.end();
});

async function newDoc(title: string, sum: string): Promise<string> {
  const [d] = await sql`
    INSERT INTO documents (bot_id, source_type, title, checksum)
    VALUES (${botId}, 'upload', ${title}, ${sum}) RETURNING id`;
  return d!.id;
}

describe("upload jobs", () => {
  it("parses HTML, indexes it, and takes the document's own title", async () => {
    const documentId = await newDoc("placeholder", `u1-${RUN}`);
    objects.set("k1", {
      body: Buffer.from(
        "<html><head><title>Acme Handbook</title></head><body><main><h1>Billing</h1><h2>Refunds</h2><p>EU customers may request a refund within 14 days of purchase.</p></main></body></html>",
      ),
      contentType: "text/html",
    });

    const res = await processJob({ kind: "upload", botId, documentId, s3Key: "k1" }, deps);
    expect(res.chunks).toBeGreaterThan(0);

    const [doc] = await sql`SELECT status, title, chunk_count FROM documents WHERE id = ${documentId}`;
    expect(doc!.status).toBe("indexed");
    expect(doc!.title).toBe("Acme Handbook");

    const chunks = await sql`SELECT heading_path, content FROM chunks WHERE document_id = ${documentId}`;
    expect(chunks.some((c) => c.heading_path.includes("Refunds"))).toBe(true);
  });

  it("indexes plain text", async () => {
    const documentId = await newDoc("notes.txt", `u2-${RUN}`);
    objects.set("k2", { body: Buffer.from("# Notes\n\nRefunds take 14 days."), contentType: "text/plain" });
    const res = await processJob({ kind: "upload", botId, documentId, s3Key: "k2" }, deps);
    expect(res.chunks).toBe(1);
  });

  it("marks an unsupported type failed WITHOUT throwing — retrying cannot help", async () => {
    const documentId = await newDoc("thing.bin", `u3-${RUN}`);
    objects.set("k3", { body: Buffer.from([0, 1, 2]), contentType: "application/octet-stream" });

    const res = await processJob({ kind: "upload", botId, documentId, s3Key: "k3" }, deps);
    expect(res).toEqual({ documents: 0, chunks: 0 });

    const [doc] = await sql`SELECT status, error FROM documents WHERE id = ${documentId}`;
    expect(doc!.status).toBe("failed");
    expect(doc!.error).toMatch(/Cannot read/);
  });

  it("records the reason and rethrows a real failure, so the message can redrive", async () => {
    const documentId = await newDoc("missing", `u4-${RUN}`);
    await expect(
      processJob({ kind: "upload", botId, documentId, s3Key: "nope" }, deps),
    ).rejects.toThrow(/no such object/);

    const [doc] = await sql`SELECT status, error FROM documents WHERE id = ${documentId}`;
    expect(doc!.status).toBe("failed");
    expect(doc!.error).toMatch(/no such object/);
  });
});

describe("snippet jobs", () => {
  it("indexes a pasted answer", async () => {
    const documentId = await newDoc("Refund policy", `s1-${RUN}`);
    const res = await processJob(
      { kind: "snippet", botId, documentId, title: "Refund policy", text: "EU customers get 14 days." },
      deps,
    );
    expect(res.chunks).toBe(1);
    const [chunk] = await sql`SELECT content, context FROM chunks WHERE document_id = ${documentId}`;
    expect(chunk!.content).toContain("14 days");
    // A snippet is already self-contained; a context line would add nothing.
    expect(chunk!.context).toBeNull();
  });
});

describe("crawl jobs", () => {
  const PROSE = "Refunds are processed within fourteen days for customers in the EU. ".repeat(6);
  const page = (title: string, links: string[] = []) =>
    `<html><head><title>${title}</title></head><body><main><h1>${title}</h1><p>${PROSE}</p>` +
    links.map((l) => `<a href="${l}">l</a>`).join("") +
    `</main></body></html>`;

  /** The same fake site every time, so a re-crawl really is identical. */
  const stubSite = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string | URL) => {
        const map: Record<string, string> = {
          "https://w.test/": page("Home", ["/billing"]),
          "https://w.test/billing": page("Billing"),
        };
        const body = map[String(u)];
        return body
          ? new Response(body, { status: 200, headers: { "content-type": "text/html" } })
          : new Response("", { status: 404 });
      }),
    );

  it("creates one document per page and indexes each", async () => {
    stubSite();
    const res = await processJob({ kind: "crawl", botId, url: "https://w.test/" }, deps);
    expect(res.documents).toBe(2);
    expect(res.chunks).toBeGreaterThan(0);

    const docs = await sql`
      SELECT title, source_url, status FROM documents WHERE bot_id = ${botId} AND source_type = 'crawl'`;
    expect(docs).toHaveLength(2);
    expect(docs.every((d) => d.status === "indexed")).toBe(true);
    expect(docs.every((d) => d.source_url?.startsWith("https://w.test"))).toBe(true);
    vi.unstubAllGlobals();
  });

  it("re-crawling unchanged pages re-embeds nothing", async () => {
    // Content-addressed: a second crawl of the identical site must cost zero
    // embedding calls, which is what makes a scheduled re-crawl affordable.
    stubSite();
    const before = fake.calls.embed;
    const res = await processJob({ kind: "crawl", botId, url: "https://w.test/" }, deps);
    expect(res.documents).toBe(0);
    expect(fake.calls.embed).toBe(before);
    vi.unstubAllGlobals();
  });
});
