# @bots/rag

The pipeline. Consumed by `apps/api` (query side), `apps/worker` (ingest side),
and `packages/eval` (both).

```
ingest    parse → chunk → contextualise → embed → index
query     rewrite → (dense ‖ bm25) → RRF → rerank → gate
```

```bash
docker compose up -d && pnpm --filter @bots/db migrate
pnpm --filter @bots/rag test
```

Tests run against a real Postgres with real pgvector and real tsvector search.
The model is faked (`src/testing.ts`) with a hashing bag-of-words embedder —
weak on purpose, so no test ends up asserting embedding quality.
