# Design system

The single source of truth for this product's interface. If this file and the
code disagree, this file is wrong and gets updated — the code does not drift
silently.

Modelled on **Supabase's dashboard**: dark-first, one confident brand green,
real borders and radii, dense but breathable, a persistent left rail. It is a
developer tool and it should look like one.

> **History.** This replaced an earlier achromatic "instrument" system. The
> reason that one existed still holds and is carried forward rather than
> discarded: users pick arbitrary pet palettes, so anywhere a pet is displayed
> sits on a **neutral surface**, never adjacent to the brand green. The rule
> moved; the problem did not.

## Colour

Dark is the default and the designed state. Light is a full second theme, not a
tint. Values follow Supabase's token structure so the whole thing reads as one
coherent system rather than a pastiche.

### Dark (default)

| Token | Hex | Use |
| --- | --- | --- |
| `--bg` | `#1C1C1C` | App canvas |
| `--bg-alt` | `#121212` | Sidebar, deeper wells |
| `--surface` | `#1F1F1F` | Cards, panels |
| `--surface-2` | `#262626` | Raised: hover rows, inputs |
| `--surface-3` | `#2E2E2E` | Pressed, active nav |
| `--border` | `#2E2E2E` | Default hairline |
| `--border-strong` | `#3E3E3E` | Emphasis, focus outline base |
| `--fg` | `#EDEDED` | Primary text |
| `--fg-light` | `#A0A0A0` | Secondary text |
| `--fg-lighter` | `#707070` | Captions, placeholders |

### Light

| Token | Hex |
| --- | --- |
| `--bg` | `#FFFFFF` |
| `--bg-alt` | `#FCFCFC` |
| `--surface` | `#F8F8F8` |
| `--surface-2` | `#F0F0F0` |
| `--surface-3` | `#E8E8E8` |
| `--border` | `#E6E6E6` |
| `--border-strong` | `#D4D4D4` |
| `--fg` | `#171717` |
| `--fg-light` | `#666666` |
| `--fg-lighter` | `#8F8F8F` |

### Brand and status

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--brand` | `#3ECF8E` | `#24B47E` | Primary actions, active nav, links |
| `--brand-hover` | `#4ADE9B` | `#1F9E6E` | |
| `--brand-fg` | `#0C1F17` | `#FFFFFF` | Text on a brand fill |
| `--brand-muted` | `rgb(62 207 142 / .12)` | `rgb(36 180 126 / .10)` | Tinted backgrounds |
| `--ok` / `--warn` / `--err` | `#3ECF8E` / `#F5A623` / `#F45B5B` | `#24B47E` / `#C77700` / `#D93838` | Status only |

**One brand colour, used sparingly.** At most one brand-filled button per view;
everything else is default or ghost. Status colours appear as a dot plus a word,
never colour alone.

## Type

| Role | Family | Notes |
| --- | --- | --- |
| UI, body | Inter | 400 / 500 / 600. 14px base — this is a dense tool, not a marketing page. |
| Code, keys, numbers | `ui-monospace` / JetBrains Mono | `tabular-nums` on anything in a column |

| Name | Size / weight |
| --- | --- |
| `title` | 20px / 600 |
| `heading` | 16px / 600 |
| `body` | 14px / 400 |
| `small` | 13px / 400 |
| `label` | 12px / 500, `--fg-light` |
| `mono` | 13px |

Sentence case everywhere. No uppercase tracking-out labels.

## Shape and depth

- **Radius** `6px` default (`--radius`); `8px` on cards; `999px` on pills and
  avatars. Nothing is square.
- **Borders** `1px solid var(--border)`. This is the primary separator — the
  system leans on borders rather than shadows.
- **Shadows** only on genuinely floating things (dropdowns, dialogs, the widget
  panel). Cards do not float.
- **Focus** `outline: 2px solid var(--brand); outline-offset: 1px`. On
  everything. Never removed.

## Layout

A persistent **left sidebar** (240px, `--bg-alt`) holds product navigation. The
main column has a sticky header carrying breadcrumbs and page actions, then
content in cards on `--bg`.

- Card: `--surface`, `1px` border, `8px` radius, `16px–20px` padding.
- Page gutter `24px`; card gap `16px`.
- Tables: header row in `--fg-light` at 12px, `1px` row borders, hover
  `--surface-2`, numeric columns `tabular-nums` and right-aligned.

## Motion

Short and functional. `120ms` for hover and focus, `180ms` for panels and
dropdowns, `ease-out`. No page transitions, no parallax, no fade-up on scroll.

The pet is the exception and keeps its full spring rig — it is the product.

`prefers-reduced-motion` disables all of it.

## Where pets appear

On `--surface` or `--bg`, in a bordered card, **never** next to a brand-green
fill. A user's palette is arbitrary and the brand green is ours; putting them
side by side makes some customer's pet look broken through no fault of theirs.

## Quality floor

Not optional:

- Responsive to 360px with **no horizontal overflow**. Wide content scrolls
  inside its own box.
- Visible keyboard focus on every interactive element.
- `prefers-reduced-motion` honoured.
- Dark and light both fully designed.
- Text contrast ≥ 4.5:1 in both themes, measured with `contrast()` from
  `@bots/core` rather than estimated.
- Colour never the only carrier of state.
- No invented numbers. Every figure shown is real.
