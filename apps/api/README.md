# @bots/api

Fastify. Two public endpoints plus a health check.

| Route | Purpose |
| --- | --- |
| `POST /v1/chat` | SSE. `{type:'delta'\|'error'\|'done'}` — the portfolio's frame shape verbatim, so its `consumeSSE` parser ports unchanged. |
| `GET /v1/bot/:key/config` | Active pet + copy, ETagged. The widget polls this; a pet swap is a 304 until it isn't. |
| `GET /health` | Touches Postgres AND Redis. A check that only proves the process is up gets containers replaced for the wrong reason. |

```bash
docker compose up -d && pnpm --filter @bots/db migrate
pnpm --filter @bots/api dev     # :8080
pnpm --filter @bots/api test
```

## Order of operations in `/v1/chat`

Everything cheap runs before anything expensive, and the model is last:

```
resolve bot → origin allowlist → rate limit → abuse screen → quota
  → retrieve (inside a tenant-scoped transaction)
  → gate: refuse verbatim, or
  → generate → validate citations → stream
```

The gate branch never calls the model at all. That is a cost property as much as
a safety one, and the test asserts `generateStream` was called zero times.

## Every request is tenant-scoped

Retrieval runs inside `withBot()`, which opens a transaction and issues
`SET LOCAL app.bot_id`. The scope dies with the transaction, so it cannot leak
into the next request that borrows the pooled connection. **The pool must
connect as `bots_app`** — a superuser bypasses RLS entirely.

`resolveBot` is the one query with no scope to run under, since resolving the
key is what produces the scope. It goes through a `SECURITY DEFINER` function
(`migrations/0002`) rather than reading the table, which returns zero rows.
