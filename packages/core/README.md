# @bots/core

Shared contracts. Nothing here talks to a database or a network socket except
through `models/` — which is the single vendor boundary in the product.

| Module | What it owns |
| --- | --- |
| `contrast.ts` | WCAG luminance + contrast. Gates the design palette *and* every generated pet palette. |
| `pet/spec.ts` | `PetSpec` — a pet is data, never drawing instructions. |
| `pet/palette.ts` | The contrast gate, calibrated against the reference robot. Read the header before changing a threshold. |
| `pet/generate.ts` | Prompt → spec, re-rolling with named failures when the gate rejects. |
| `models/provider.ts` | `ModelProvider` / `Reranker`. `EMBED_DIM` is a hard pgvector constraint, not a knob. |
| `models/gemini.ts` | Gemini adapter + LLM reranker. |
| `rag/fusion.ts` | Reciprocal Rank Fusion. |
| `rag/grounding.ts` | Grounding modes and the relevance gate. |
| `rag/prompts.ts` | System prompt assembly + citation validation. |
| `rag/abuse.ts` | Inbound screening and chunk injection scanning. |

```bash
pnpm --filter @bots/core test
```
