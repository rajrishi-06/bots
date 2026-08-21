# @bots/dashboard

Next.js creator studio, built against `DESIGN.md` ("Terrarium").

```bash
docker compose up -d && pnpm --filter @bots/db migrate
pnpm --filter @bots/db seed          # prints a DEV_ORG_ID
pnpm --filter @bots/dashboard dev    # :3001
```

## The signature screen

`/bots/[id]/playground` — the retrieval debug panel. Three things make it an
instrument readout rather than a JSON dump, and each is asserted by a test:

- **Paired score bars.** Pre-rerank and post-rerank on the same row, so the
  cross-encoder's reordering is something you *watch*. One bar shows a ranking;
  two show a decision.
- **The gate threshold is a drawn line** positioned at its actual value, so a
  query falling under it is a spatial fact rather than two numbers to compare.
- **The numbers shown are the real ones.** Bar widths are normalised so the two
  are visually comparable; the printed score never is.

It runs the same `retrieve()` the API serves from. A playground with its own
query path would show you a pipeline nobody is running.

## Auth is a stub

`src/lib/session.ts` returns a development session and **throws in production**.
An auth shim that silently authorises is worse than none, because it looks
finished. Clerk drops into that one function.

Every query still runs inside a transaction carrying `SET LOCAL app.org_id`, so
row-level security is the real boundary regardless — and the pool connects as
`bots_app`, never the master user.

## Client bundle note

Client components import `@bots/core/rag`, not `@bots/core`. The barrel
re-exports the models module, which imports the Gemini SDK; importing it from a
client component put 41.8 kB of vendor SDK into the browser for what is three
buttons.
