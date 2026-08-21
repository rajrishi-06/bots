# Plan

Living status. Updated as things land. If this and the code disagree, this file
is stale — fix it.

Companion docs: [`DESIGN.md`](./DESIGN.md) is the interface thesis. Each package
README explains the decisions inside it.

---

## Done

### Foundation
- pnpm + Turborepo monorepo, 12 packages, strict TypeScript throughout.
- `DESIGN.md` — the "Terrarium" thesis. Palette contrast is **measured** with the
  same function that gates generated pets, not eyeballed.
- CI on every push: typecheck, tests against a **real** Postgres + Redis, and
  bundle-budget enforcement.

### Data
- Postgres 16 + pgvector. HNSW on `vector_ip_ops`, GIN on a **generated**
  tsvector column that cannot drift from `content`.
- RLS on every tenant table, forced, fail-closed. Two scopes: `app.bot_id` for
  widget traffic, `app.org_id` for the dashboard.
- Exactly one active pet per bot, via a partial unique index.
- `resolve_bot_by_key` as `SECURITY DEFINER` — the one lookup with no scope to
  run under, since resolving the key is what *produces* the scope.

### Retrieval
- Ingest: structure-aware chunking (heading paths preserved, tables and code
  fences atomic), batched context lines, atomic re-index.
- Query: rewrite → dense ‖ BM25 → RRF → rerank → relevance gate.
- Three grounding modes with a persisted risk acknowledgement.
- Abuse guards that run **before** the model: off-purpose screen, prompt-
  extraction screen, sliding-window rate limits, hard monthly quota.
- Eval harness with a handwritten golden set and a per-stage ablation.

### Pet engine
- ~150-line rAF spring primitive replacing framer-motion. One shared ticker.
- Fixed joint slots, so activating a different pet is a **data change**, not a
  remount — tested by swapping mid-swing and asserting the angle is unchanged.
- Five themes: `robot`, `pixel`, `animal`, `ghost`, `mech`.
- Prompt → spec → live preview → save, with a contrast gate and re-roll.

### Widget
- Preact in a **closed** shadow root. 22.6 kB gzip (budget 30); loader 419 B
  (budget 2). Both CI-enforced.
- Owner-configurable appearance: header, corners, bubbles, density, accent,
  launcher size, feedback.
- Owner-defined quick actions (link or canned prompt). Links https-only at
  three layers.
- **Verified working on a hostile third-party origin** — Comic Sans, hotpink
  `!important`, `svg { filter: invert(1) }`. Isolation holds.

### Studio
- Create a bot → design a pet → feed it → test it → embed it, end to end.
- The **retrieval debug panel**: paired pre/post-rerank bars, the gate drawn as
  a line, heading paths, per-stage timings.
- Monitor: conversations, and unanswered questions merged from gate refusals
  *and* thumbs-down.

### Infrastructure
- CDK, three stacks, synthesising clean, with assertions against the generated
  templates. **Nothing deployed.**

---

## Verified against live models

All eleven end-to-end acceptance checks pass: near-duplicate sections answered
apart, the gate refusing out-of-scope and the same question answering in
blended, a multi-turn follow-up resolved by rewriting, a poisoned document that
is retrievable but not obeyed, and a cross-tenant probe returning zero rows.

---

## To do

| | Why it matters |
| --- | --- |
| **Deploy** — bootstrap CDK, populate the model secret, create `bots_app`, run migrations | Nothing is live. This is the gap between "works" and "shipped". |
| **Auth** — Clerk into `src/lib/session.ts` | The stub throws in production by design. One function. |
| **File upload UI** — presigned PUT → S3 → SQS | The worker handles uploads; there is no way to trigger one from the studio. Crawl and snippet work. |
| **Desktop** — transparency and the stray chat window | Builds and runs; looks wrong. See below. |
| **Demo site** | Nothing public to point at. |

---

## To improve

**Rerank latency, 8–17s per query.** The single worst number in the system and
the clearest next win. It is the LLM-as-reranker; a real cross-encoder (Cohere,
Bedrock, NeMo when reachable) drops in behind the existing `Reranker` interface
and should be both faster and cheaper.

**recall@5 is saturated at the current corpus size.** 40 chunks against a
candidate depth of 50 means every retriever sees everything, so MRR and nDCG are
the only metrics doing work. Past ~200 chunks recall becomes meaningful again.

**RRF fusion alone is a ranking regression** (MRR 0.938 → 0.896). It is a recall
device, not a ranker, and only pays for itself with rerank behind it. Worth
revisiting the fusion weighting once a real cross-encoder is in.

**Model quota.** The free tier on the capable chat model is spent;
`gemini-3.1-flash-lite` is the working default and measured *better* on two
counts that matter here — it honours `thinkingBudget: 0`, and it answers
retrieval questions more directly.

**`taskType` is inert.** Asymmetric embedding is not actually happening on this
provider — a live test pins the behaviour so we notice if it ever starts working.

**Smoothness is untested by machine.** The headless pane reports
`visibilityState: "hidden"`, so neither rAF nor CSS animations run in it. Motion
is covered by unit tests; whether it *feels* right needs human eyes.

---

## Known broken

**Desktop app.** Compiles, runs, bundles a `.dmg` — and looks wrong: the
transparent window is not transparent, and the chat window shows when it should
be hidden. Parked in favour of web.

---

## Decisions worth not re-litigating

- **The pet is the only thing that moves or carries colour.** Users pick
  arbitrary pet palettes; any accent hue of ours clashes with somebody's pet.
- **4.5:1 on both white and near-black is impossible** — the curves cross at
  4.435. The pet gate is a palette-level straddle check at 3:1, calibrated
  against the reference robot.
- **Migrations run as the master user; the app never does.** The master is a
  superuser and superusers bypass RLS entirely.
- **Appearance is a closed set, not free-form CSS.** Arbitrary CSS in a shadow
  root the owner does not control is a defacement vector.
- **The widget ships no zod.** The API validates; the widget normalises. Pulling
  zod in cost 20 kB of a 30 kB budget.
