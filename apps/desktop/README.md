# @bots/desktop

Tauri v2 shell. The pet floats over the desktop; the chat panel is
`@bots/widget` unchanged — a different shell around the same Preact app, not a
second implementation.

> **Not built yet.** This needs a Rust toolchain, which is not installed on this
> machine, and a Tauri `target/` directory runs 2–4 GB. The TypeScript side
> typechecks; the Rust side has never been compiled. Treat it as unverified.

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
pnpm --filter @bots/desktop dev
```

## The one problem the browser build never has

A transparent, always-on-top, undecorated window is a 220×220 **hole in the
desktop**. Every click inside its bounds goes to it — including the ~85% that is
empty space around the creature — so without intervention the buddy silently
eats clicks meant for whatever is underneath.

`set_ignore_cursor_events` is the only mechanism that fixes it, and it is
per-window and all-or-nothing. So the frontend tracks whether the cursor is over
the pet's actual silhouette and toggles it, because only the frontend knows
where the pet currently is — it drifts, and its bounding box moves with it.

The hit region is a **circle**, not the bounding box: the pet is roughly round,
and a square region reclaims corners that visibly contain nothing.

The window starts fully click-through and is only switched off once the pointer
is over the creature. Starting the other way round means the window swallows a
click before any JavaScript has run.

## Deferred

Code signing and notarisation — Apple Developer (~$99/yr) and a Windows
certificate. Needed for distribution, not for running it.
