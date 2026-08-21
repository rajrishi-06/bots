# @bots/pet-engine

Framework-agnostic SVG rig. The dashboard drives it from React, the widget from
Preact, and neither re-renders once per frame — every joint's `transform` is
written imperatively.

```bash
pnpm --filter @bots/pet-engine dev     # gallery of 12 live rigs at :5174
pnpm --filter @bots/pet-engine test
```

| File | What it owns |
| --- | --- |
| `spring.ts` | ~150-line rAF spring primitive replacing framer-motion. One shared ticker for the whole document. |
| `pivots.ts` | The FIXED joint slots and the spring tiers. Read the sign convention before touching a rotation. |
| `parts.ts` | The vetted geometry library. The model selects from it; it never emits markup. |
| `rig.ts` | `PetRig` — builds the SVG from a spec and drives it. |

## Two constraints that look like details and are not

**The joint slots are fixed.** Every part is authored to the same pivots, which
is what makes activating a different pet a data change instead of a remount —
`setSpec()` rebuilds geometry while the spring chain keeps running.

**Gradient ids are namespaced per instance.** SVG gradient ids are
document-global, and the gallery puts twelve pets on one page. Without the
namespace, every pet after the first paints in the first one's colours.
