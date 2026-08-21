# @bots/eval

Turns "retrieval feels good" into a number a regression can fail on.

```bash
docker compose up -d && pnpm --filter @bots/db migrate
GEMINI_API_KEY=… pnpm --filter @bots/eval bench
```

It runs the **same `retrieve()` the API serves from**, not a reimplementation —
a harness that measures its own copy of the pipeline measures nothing.

## Measured baseline

40 chunks (the handbook plus two deliberately confusable distractors), 16
in-scope questions, 3 out-of-scope. `gate` is the share of out-of-scope
questions the relevance gate correctly refused.

```
configuration    recall@5    P@5    MRR  nDCG@10   miss  gate       ms
dense only          1.000  0.200  0.938    0.954  0.000  0.00     9283
bm25 only           0.875  0.318  0.813    0.829  0.125  1.00       56
hybrid + RRF        1.000  0.200  0.896    0.923  0.000  0.00    19246
hybrid + rerank     1.000  0.200  0.969    0.977  0.000  1.00   325734
full pipeline       1.000  0.200  0.969    0.977  0.000  1.00   144914
```

### What this actually says

**RRF fusion on its own is a ranking REGRESSION here.** MRR drops from 0.938
(dense alone) to 0.896 once a weaker BM25 list is fused in. That is the opposite
of what the plan assumed. RRF is not a ranker — it is a recall device that
broadens the candidate pool, and it needs a reranker behind it to pay for
itself. Rerank then takes it to 0.969, above dense alone.

**The relevance gate does not work without the reranker.** Gate accuracy is 0.00
for every configuration without rerank and 1.00 with it. RRF scores live on a
~1/60 scale with no calibration, so nothing ever falls below a threshold and
every out-of-scope question gets answered. This — not recall — is the strongest
argument for the rerank stage, and it would not have shown up in a recall-only
evaluation.

**recall@5 is saturated and is not the metric doing work here.** 40 chunks
against `CANDIDATE_K = 50` means every retriever sees the whole corpus, so
anything with a dense leg scores 1.000. MRR and nDCG@10 are the discriminating
numbers at this corpus size. Growing the corpus past ~200 chunks would make
recall@5 meaningful again.

**Latency is the open problem.** Rerank costs 8–17s per query — that is the LLM
reranker scoring ~40 candidates in one call, and it is not shippable for a chat
widget. It is the concrete case for swapping in a real cross-encoder (NeMo
Retriever, Cohere, Bedrock) behind the existing `Reranker` interface. Everything
else in the pipeline is comfortably sub-second.

## What it already caught

BM25 was returning **zero rows for every question** while looking like it ran.
`websearch_to_tsquery` ANDs its terms, so "How long do EU customers have to
request a refund?" became `'long' & 'eu' & 'custom' & 'request' & 'refund'` and
no chunk contained all five. Hybrid search was dense-only in production and
nothing failed. See `bm25Search` in `@bots/rag`.

## Design notes

- The golden set is **handwritten**. Generating it with the same family of model
  that answers the questions measures agreement, not retrieval.
- Labels are substrings resolved to chunk ids at run time, scoped to the primary
  document — so re-chunking the corpus does not silently invalidate every label,
  and a distractor containing the same phrase never counts as correct.
- Questions target specific failure modes: near-duplicate sections differing by
  one qualifier, answers inside tables, questions sharing no content words with
  their answer, rare exact tokens, and out-of-scope probes.
