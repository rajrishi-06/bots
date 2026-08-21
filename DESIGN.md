# Design system — "Terrarium"

The single source of truth for this product's interface. Every component is
built against this file. **If this file and the code disagree, this file is
wrong and gets updated — the code does not drift silently.**

This inherits the discipline of the Datasheet system in `portfolio-v2`, not its
palette. Same rule about holding a thesis; different thesis.

## The idea

A terrarium is a **precise glass instrument containing one living thing.**

That is exactly this product. A cold, exact control surface — retrieval scores,
chunk tables, rerank deltas, ingest status — wrapped around a creature that is
warm and alive. The tension *is* the design.

### The governing rule

> **The pet is the only thing in the interface that moves, and the only thing
> that carries colour. Everything else is still and achromatic.**

Both halves are functional, not preference:

- **Colour.** Users pick arbitrary pet palettes. If the chrome owns an accent
  hue, some user's pet will always clash with it. An achromatic instrument
  makes *every* pet palette read correctly. There is no accent colour in this
  system — "accent" is a **value step**, not a hue: ink fill, or ink text with
  a rule under it.
- **Motion.** If the chrome animates, the pet stops being the hero and motion
  becomes decoration. The pet's every movement is derived from real velocity;
  nothing else in the product has earned the right to move.

The one exception is **state**, which cannot be communicated by value alone —
see § Signal.

## What this replaces

| Out | In |
| --- | --- |
| Purple→blue gradient hero, ✨ "AI sparkle" iconography | Achromatic chrome; the pet is the only mascot |
| Glassmorphism, `backdrop-filter`, glow | Flat fills, hairline rules |
| `rounded-2xl` on everything | Radius 0; 2px only on interactive chips |
| Floating drop shadows | Rules and negative space |
| Default shadcn sidebar-and-cards shell | Numbered sections, real data tables, a margin rail |
| Stock 3D illustrations, spot hero art | Live rigs — every pet shown is a running instance |
| Skeleton shimmer loaders | The pet dozes/wakes; ingest shows real per-stage progress |

**Rule:** if a change needs a gradient, a blur, or a shadow to work, it is the
wrong change.

## Colour

Cool float-glass grey. The ground carries the barest green cast — the colour of
the edge of a sheet of glass — so it does not read as default Tailwind grey,
but the chroma is low enough that it never competes with a pet.

Every text tier clears **4.5:1 against both `bg` and `surface`**. These numbers
are computed by `contrast()` in `@bots/core`, not eyeballed. If you retune the
palette, re-run the measurement — the same function gates every pet palette, so
it is always to hand.

### Light (default)

| Token | Hex | On `bg` | On `surface` | Use |
| --- | --- | --- | --- | --- |
| `bg` | `#F0F2EF` | — | — | Page ground |
| `surface` | `#E5E8E3` | — | — | Insets, table hover, blocks |
| `ink` | `#131614` | 16.18 | 14.74 | Primary text, rules, primary fill |
| `muted` | `#454A46` | 8.04 | 7.32 | Body secondary, table cells |
| `faint` | `#5D635E` | 5.47 | 4.98 | Labels, captions, row numbers |

### Dark

The negative of the same sheet — not a different design.

| Token | Hex | On `bg` | On `surface` |
| --- | --- | --- | --- |
| `bg` | `#0E100F` | — | — |
| `surface` | `#171A18` | — | — |
| `ink` | `#E9ECE8` | 16.03 | 14.72 |
| `muted` | `#AFB5B0` | 9.15 | 8.40 |
| `faint` | `#848B86` | 5.47 | 5.03 |

`overlay` is black in light, white in dark, so hairlines and hover fills flip
with the theme. **Rules are `overlay` at 0.14 (hairline) or 0.28 (structural).
Nothing between.**

### Signal

Three functional colours. They exist because ingest failure and a fired
relevance gate cannot be communicated by a value step, and getting that wrong
costs the user real time.

| Token | Light | on `bg` / `surface` | Dark | on `bg` / `surface` |
| --- | --- | --- | --- | --- |
| `ok` | `#2E6F45` | 5.37 / 4.89 | `#5FBE86` | 8.36 / 7.68 |
| `warn` | `#8A5A00` | 5.26 / 4.79 | `#D69B36` | 7.82 / 7.18 |
| `err` | `#A32B22` | 6.37 / 5.80 | `#E8695C` | 6.01 / 5.52 |

**Signal colours appear only as a 2px bar, a 6px dot, or small mono text.**
Never a fill, never a button, never a background. They are annotations on the
instrument, not part of its chrome. Colour is never the *only* carrier — every
signal also has a word (`FAILED`, `GATED`, `INDEXED`).

## Type

Three faces, three jobs. No face does two jobs. Same split as the Datasheet,
because it was right.

| Role | Family | Notes |
| --- | --- | --- |
| Display / headings | Spectral | 400 + 600 |
| Body / prose | Inter | 400/500/600 |
| Data, labels, numbers | IBM Plex Mono | **Everything small is mono** |

Mono is the instrument's voice: section numbers, table headers, scores, chunk
ids, ingest stages, captions, quotas. Every score in this product is a number in
mono with `font-variant-numeric: tabular-nums`, so columns of them align.

| Name | Size / leading | Face | Use |
| --- | --- | --- | --- |
| `hero` | `clamp(2.25rem,5vw,3.5rem)` / 1.02 | display | One per page |
| `title` | `clamp(1.5rem,3vw,2.25rem)` / 1.1 | display | Section H2 |
| `sub` | `1.125rem` / 1.45 | display | Lead paragraphs |
| `body` | `0.9375rem` / 1.65 | sans | Prose |
| `label` | `0.6875rem` / 1.2, `tracking-[0.14em]`, uppercase | mono | Rail labels, table heads |
| `data` | `0.8125rem` / 1.4 | mono | Cell values, scores, chunk ids |

## Layout — the rail

Two-column measured grid, repeated down every screen. `lg:grid-cols-[176px_1fr]`,
`gap-x-10`; the rail collapses to one horizontal line below `lg` and is
`sticky top-28` above it. Full-bleed hairline between sections. Section padding
`py-16 lg:py-24`.

## Motion

The pet moves. **Two** things in the chrome move, and only because they carry
information that is genuinely temporal:

1. **Ingest stage progress** — a real per-stage bar (parse → chunk → context →
   embed → index). It moves because the work is moving. Never a shimmer, never
   an indeterminate spinner where a real fraction is available.
2. **Rule draw on section entry** — hairline `scaleX(0)→1`, origin left, 600ms.
   Inherited from the Datasheet. Content is present on load; only the rule
   animates.

Anything else does not animate. No stagger, no parallax, no fade-up, no
skeletons, no magnetic buttons, no tilt.

`prefers-reduced-motion` pins the pet's entire spring chain to 0 (it still
tracks the pointer, it just stops swinging) and disables both chrome behaviours.

## The widget is a separate token set

The widget lives on **someone else's page**, over a background we do not
control. It cannot use these tokens. It derives its surface from the active
pet's palette and must hold legibility on an unknown ground.

The reference implementation states the constraint exactly — *"the bot floats
over the page, so it carries its own light."*

### The measured constraint on pet palettes

Generalising that into a validator turned up a hard limit worth writing down,
because the obvious rule is impossible:

> For a colour of relative luminance `L`, contrast against white is
> `1.05/(L+0.05)` and against near-black is `(L+0.05)/0.05335`. Those curves
> cross at `L ≈ 0.1867`, where both equal **4.435:1**.
>
> **No colour that exists clears 4.5:1 against both white and near-black.**

So the pet gate is not per-colour, and it is not 4.5. A pet is a graphic, so the
standard is WCAG 1.4.11 non-text contrast, **3:1** — and it applies to the
**silhouette**, not to each stop.

Applying even 3:1 to every stop rejects the reference robot, which demonstrably
works on both white and near-black pages (four of its seven stops fail alone;
its highlight `#C3CDFB` scores 1.56 worst-case). It works because the dark stops
hold the outline against a white page, the light stops hold it against a dark
one, and the shell gradient runs between them.

The gate, calibrated against that known-good design (`validatePetPalette` in
`@bots/core`, reference scores in brackets):

| Rule | Threshold | Reference |
| --- | --- | --- |
| Darkest stop vs white | 3:1 | 19.59 |
| Lightest stop vs near-black | 3:1 | 12.60 |
| `lit` vs `visorHi` — the eyes are the face | 4.5:1 | 8.06 |
| `visorHi` vs `shellHi` — visor reads as a panel | 3:1 | 3.82 |
| `shellHi` vs `shellLo` — gradient is perceptible | 1.3:1 | 2.60 |

A generated palette that fails is re-rolled with the failures named in the
prompt. **An AI-designed pet that is invisible on a dark site is a bug, and the
schema is where it gets caught.**

## The signature screen

The **retrieval debug panel**. This is where the product shows its intelligence,
and no competitor exposes it. It is drawn as an instrument readout, not a JSON
dump:

- Ranked chunks, one row each, mono, tabular-nums.
- **Paired score bars** — pre-rerank and post-rerank on the same row, so the
  cross-encoder's reordering is visible as movement rather than asserted.
- The **gate threshold as a drawn line** across the score column, so you can
  watch a query fall under it.
- `heading_path` on every chunk ("Billing › Refunds › EU"), because that is what
  makes a retrieved chunk legible at a glance.

Everything else on the screen stays quiet so this reads.

## Component rules

- **Radius** `0`. Exception: `2px` on chips, inputs, buttons.
- **Borders** `1px solid rgb(var(--c-overlay)/0.14)`; structural `/0.28`. Never
  a coloured border except `:focus-visible`.
- **Buttons** square, 1px rule, mono uppercase label, `tracking-[0.08em]`.
  Primary is a solid ink fill with paper text. No shadow, ever.
- **Focus** `outline: 2px solid ink; outline-offset: 2px`. On everything. Never
  removed. (Ink, not an accent hue — see the governing rule.)
- **Tables** hairline row rules only. No vertical rules, no zebra except hover.
  Numeric columns `tabular-nums`.
- **Live pets** every pet shown in the product is a running rig, never a
  screenshot. Galleries virtualize and cap concurrent rigs (~12 animating; the
  rest paused via `IntersectionObserver`), because each rig runs its own rAF
  spring chain.

## Quality floor

Not optional:

- Responsive to 360px, no horizontal overflow.
- Visible keyboard focus on every interactive element.
- `prefers-reduced-motion` honoured by the pet and both chrome behaviours.
- Light and dark both fully designed. Dark is not a tint.
- Contrast: body ≥4.5:1, large ≥3:1, both themes. Measured, not estimated.
- Colour is never the only carrier of state.
- No invented numbers. Every score shown is a real score from a real retrieval.
