# bots

Custom visual pets that answer from your documents, embeddable anywhere with one
`<script>` tag.

Read [`DESIGN.md`](./DESIGN.md) before touching any interface code. If the file
and the code disagree, the file is wrong and gets updated — the code does not
drift silently.

## Layout

```
apps/
  dashboard/   Next.js — creator studio
  api/         Fastify on Fargate — /v1/chat, control plane
  worker/      SQS consumer — ingestion
  desktop/     Tauri v2 shell
packages/
  core/        Schemas, PetSpec, ModelProvider, prompts, grounding, abuse guards
  db/          Drizzle schema, migrations, RLS
  rag/         The pipeline — ingest and query
  pet-engine/  Framework-agnostic SVG rig + parts library
  widget/      Preact + Shadow DOM embeddable
  sdk-js/      ~2KB loader
  eval/        Retrieval + generation eval harness
infra/         AWS CDK
```

## Getting started

```bash
pnpm install
docker compose up -d                 # postgres:5433, redis:6380
pnpm --filter @bots/db migrate       # extension + schema + RLS
pnpm typecheck && pnpm test
```

Copy `.env.example` to `.env` and set `GEMINI_API_KEY` for anything that talks to
a model. The test suites do not need one — they use deterministic doubles.

**Connect as `bots_app`, never as the Postgres master user.** The master user is
a superuser, and superusers bypass row-level security even with `FORCE`. See
[`packages/db/README.md`](./packages/db/README.md).
