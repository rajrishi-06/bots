# @bots/widget + @bots/sdk-js

The embeddable. One script tag, a closed shadow root, and a live pet.

```html
<script src="https://cdn.example.com/petbot.js" data-bot-id="pb_live_…"></script>
```

| Bundle | Budget | Actual (gzip) |
| --- | --- | --- |
| `petbot.js` (widget) | 30 kB | **17.3 kB** |
| `loader.js` | 2 kB | **419 B** |

Enforced in CI. The loader is all that runs on page load; the widget is imported
when the browser goes idle, because a customer pastes this into a marketing site
and it must not cost them a metric.

## What ports from portfolio-v2, and why unchanged

`position.ts` is the portfolio's file with one addition (a per-bot storage key).
The behaviour in it was worked out against real devices and is easy to get
subtly wrong:

- Resize clamps the launcher for **display** while preserving the user's
  unclamped intent, so a temporary window shrink does not destroy the spot they
  dragged to.
- The panel has no fixed corner — it opens into whichever side has room.
- The mobile keyboard **lifts** the panel rather than shrinking it; shrinking
  makes it unreadable.
- iOS pins `document.body` while the panel is open, because focusing an input in
  a fixed overlay otherwise makes Safari scroll the panel off the top.

The SSE parser carries over too, including the frame shape, so the wire format
is identical on both products.

## Containment

The shadow root is **closed**: a host page has no legitimate reason to reach
into the widget, and an open root would let a host script read a visitor's
conversation out of the DOM. The stylesheet opens with `all: initial` because
inherited properties (font, colour, line-height) cross a shadow boundary even
though selectors do not.

A failed embed logs a warning and renders nothing. It must never put an error
box on a customer's page.
