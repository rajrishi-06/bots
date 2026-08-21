# @bots/worker

SQS consumer. Turns an upload, a crawl, or a pasted snippet into indexed chunks.

```bash
pnpm --filter @bots/worker test
INGEST_QUEUE_URL=… INGEST_BUCKET=… pnpm --filter @bots/worker start
```

The polling loop in `main.ts` is deliberately thin — all the work is in
`processJob`, which is tested directly against a real Postgres. There is no
queue abstraction with two implementations, because the loop is six lines.

## What gets acked, and what doesn't

| Outcome | Ack? | Why |
| --- | --- | --- |
| Success | yes | — |
| Unparseable message body | **yes** | Retrying malformed JSON produces the same malformed JSON. The DLQ is for work that could succeed later. |
| Unsupported file type | **yes** | Document is marked `failed` with the reason. Re-queueing a scanned PDF forever changes nothing; the owner needs to see it. |
| Anything else | **no** | Returns to the queue, and after the redrive policy lands in the DLQ. |

`VisibilityTimeout` is 900s because ingesting a large PDF takes minutes, and a
short timeout hands the same job to a second worker while the first is still on it.

## HTML → Markdown is hand-written

Everything downstream speaks markdown because the chunker splits on document
structure. A generic converter either flattens headings — which costs every
chunk its `headingPath`, the cheapest retrieval signal in the pipeline — or
drags in a full DOM implementation to preserve them.

It also narrows to `<main>`/`<article>` before converting. A crawled page is
mostly navigation and footers, and indexing those gives every chunk in the
corpus the same boilerplate vocabulary, so every query matches the nav.

## Crawl is content-addressed

A page whose text has not changed since the last crawl is skipped without
re-embedding. That is what makes a scheduled re-crawl affordable, and there is a
test asserting a second identical crawl costs zero embedding calls.
