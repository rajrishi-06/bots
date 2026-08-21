import type { PetSpec } from "@bots/core/pet";
import { PetRig } from "@bots/pet-engine";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { BotClient, StreamError, type BotConfig, type Turn } from "./api.js";
import { markdown } from "./markdown.js";
import {
  clampLauncherPos,
  configureStorage,
  loadLauncherPos,
  placePanel,
  readStoredPos,
  saveLauncherPos,
  type PanelBox,
  type Point,
} from "./position.js";

/** Breathing room between the panel's bottom and the on-screen keyboard. */
const KEYBOARD_GAP = 8;
/** Below this a drag is treated as a click, so a shaky tap still opens the panel. */
const DRAG_SLOP = 4;

/** A live rig bound to an <svg>. Preact never re-renders it. */
function Pet({ spec, onRig }: { spec: PetSpec; onRig?: (r: PetRig | null) => void }): JSX.Element {
  const ref = useRef<SVGSVGElement>(null);
  const rigRef = useRef<PetRig | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rig = new PetRig(ref.current, spec, {
      reducedMotion: reduced,
      gaze: window.matchMedia("(hover: hover)").matches,
    });
    rigRef.current = rig;
    onRig?.(rig);
    return () => {
      rig.destroy();
      rigRef.current = null;
      onRig?.(null);
    };
    // Built once. A changed spec is a hot-swap, not a rebuild — see below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hot-swap: the joint slots are fixed, so this morphs the geometry under a
  // still-running spring chain. No remount, no reload, no dropped frame.
  useEffect(() => {
    rigRef.current?.setSpec(spec);
  }, [spec]);

  return <svg ref={ref} />;
}

export function Widget({
  client, config, host,
}: {
  client: BotClient;
  config: BotConfig;
  /** The shadow HOST. Needed to tell our own clicks from the page's — see below. */
  host: Element;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rigRef = useRef<PetRig | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The launcher's position is the single source of truth: draggable, persisted,
  // and clamped back on resize. The panel has no fixed corner — it is placed
  // from wherever the launcher currently is.
  const posRef = useRef<Point>(loadLauncherPos(window.innerWidth, window.innerHeight));
  // The UNCLAMPED spot the user dragged to. Kept separately so a temporary window
  // shrink does not overwrite their intent and a later grow restores it.
  const desiredRef = useRef<Point>(readStoredPos() ?? posRef.current);
  const [, force] = useState(0);
  const [box, setBox] = useState<PanelBox>(() =>
    placePanel(posRef.current, window.innerWidth, window.innerHeight),
  );

  const paint = useCallback(() => {
    const el = launcherRef.current;
    if (el) el.style.transform = `translate(${posRef.current.x}px, ${posRef.current.y}px)`;
  }, []);
  useLayoutEffect(paint);

  /* ── Drag ──────────────────────────────────────────────────────────────── */
  const drag = useRef({ active: false, moved: false, x: 0, y: 0, t: 0 });

  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    drag.current = { active: true, moved: false, x: e.clientX, y: e.clientY, t: performance.now() };
    launcherRef.current?.setPointerCapture(e.pointerId);
    rigRef.current?.setState({ pressed: true });
  };

  const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d.active) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return; // a shaky tap is still a tap
    if (!d.moved) {
      d.moved = true;
      rigRef.current?.setState({ dragging: true });
    }

    // Velocity by hand, since framer-motion's useVelocity is gone. Floored at
    // 8ms because a sub-frame dt divides into an absurd speed and snaps the rig.
    const now = performance.now();
    const dt = Math.max(now - d.t, 8) / 1000;
    rigRef.current?.setVelocity(dx / dt, dy / dt);

    posRef.current = clampLauncherPos(
      { x: posRef.current.x + dx, y: posRef.current.y + dy },
      window.innerWidth,
      window.innerHeight,
    );
    d.x = e.clientX;
    d.y = e.clientY;
    d.t = now;
    paint();
  };

  const endDrag = () => {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    rigRef.current?.setState({ dragging: false, pressed: false });
    rigRef.current?.setVelocity(0, 0);
    if (d.moved) {
      desiredRef.current = posRef.current;
      saveLauncherPos(posRef.current);
    }
  };

  /* ── Resize ────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const onResize = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Clamp the persisted intent for DISPLAY only. Re-saving here would let a
      // shrink overwrite the dragged spot so a later grow could not restore it.
      posRef.current = clampLauncherPos(desiredRef.current, vw, vh);
      paint();
      setBox(placePanel(posRef.current, vw, vh));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [paint]);

  /* ── Mobile keyboard ───────────────────────────────────────────────────── */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !open) return;
    const fit = () => {
      const base = placePanel(posRef.current, window.innerWidth, window.innerHeight);
      const visibleBottom = vv.offsetTop + vv.height;
      const overlap = base.top + base.height - (visibleBottom - KEYBOARD_GAP);
      const left = base.left + vv.offsetLeft;
      // Lift, never shrink: resizing the panel to dodge the keyboard makes it
      // unreadable, while lifting keeps the input right above the keys.
      const top = overlap > 0 ? base.top - overlap : base.top;
      setBox((prev) =>
        prev.left === left && prev.top === top && prev.width === base.width && prev.height === base.height
          ? prev
          : { left, top, width: base.width, height: base.height },
      );
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
    };
  }, [open]);

  /* ── iOS scroll lock ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (!open || !window.matchMedia("(max-width: 639px)").matches) return;
    // Focusing an input inside a fixed overlay makes iOS scroll the document to
    // reveal it, flinging the panel off the top. Pinning the body holds it still.
    const { scrollX, scrollY } = window;
    const body = document.body;
    const prev = { position: body.style.position, top: body.style.top, width: body.style.width };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      window.scrollTo(scrollX, scrollY);
    };
  }, [open]);

  /* ── Panel behaviour ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      // Compare against the HOST, not the panel, and not via composedPath().
      //
      // The shadow root is CLOSED, and a closed root does not expose its
      // internals to composedPath() calls from outside it — the path starts at
      // the host. So `composedPath().includes(panel)` was false for EVERY click,
      // including clicks on the panel's own buttons, and the panel closed the
      // instant you tried to use it. It only reproduced on a real page: happy-dom
      // does not enforce closed-root retargeting.
      //
      // Events from inside a shadow tree retarget to the host for outside
      // listeners, so `target === host` means "this click was ours".
      if (e.target === host) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, host]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [turns, streaming]);

  /* ── Sending ───────────────────────────────────────────────────────────── */
  const send = async (text: string) => {
    const content = text.trim();
    if (!content || streaming) return;
    setError(null);
    setInput("");
    const history = [...turns, { role: "user" as const, content }];
    setTurns([...history, { role: "assistant", content: "" }]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await client.chat(content, turns, {
        signal: controller.signal,
        onDelta: (delta) =>
          setTurns((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") next[next.length - 1] = { ...last, content: last.content + delta };
            return next;
          }),
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof StreamError ? err.message : "Something went wrong.");
        // Drop the empty assistant bubble rather than leaving a silent blank.
        setTurns((prev) => {
          const last = prev[prev.length - 1];
          return last?.role === "assistant" && !last.content ? prev.slice(0, -1) : prev;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const openPanel = () => {
    setBox(placePanel(posRef.current, window.innerWidth, window.innerHeight));
    setOpen(true);
    force((n) => n + 1);
  };

  return (
    <>
      <div class="panel-layer" aria-hidden={!open}>
        <div
          ref={panelRef}
          class="panel"
          data-open={String(open)}
          role="dialog"
          aria-label={`${config.name} assistant`}
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        >
          <div class="bar">
            <div class="dots">
              <button
                class="dot"
                style="background:#ff5f57"
                aria-label="Close and clear the conversation"
                onClick={() => {
                  setOpen(false);
                  setTurns([]);
                  setError(null);
                }}
              />
              <button
                class="dot"
                style="background:#febc2e"
                aria-label="Minimise, keeping the conversation"
                onClick={() => setOpen(false)}
              />
              <span class="dot" style="background:#28c840;opacity:.4" aria-hidden="true" />
            </div>
            <span class="bar-title">{config.name}</span>
          </div>

          <div class="log" ref={logRef}>
            <div class="row">
              <span class="avatar">
                <Pet spec={config.pet} />
              </span>
              <div class="bubble">{markdown(config.greeting)}</div>
            </div>

            {turns.map((t, i) => (
              <div class={t.role === "user" ? "row me" : "row"} key={i}>
                <span class="avatar">
                  {t.role === "user" ? (
                    // A glyph, not the word "you": at 26px the text overflowed
                    // the avatar and spilled outside the panel entirely.
                    <svg viewBox="0 0 16 16" width="13" height="13" fill="none"
                         stroke="currentColor" stroke-width="1.6" aria-label="You">
                      <circle cx="8" cy="5.5" r="2.8" />
                      <path d="M2.5 14c0-3 2.5-4.6 5.5-4.6S13.5 11 13.5 14" stroke-linecap="round" />
                    </svg>
                  ) : (
                    <Pet spec={config.pet} />
                  )}
                </span>
                <div class="bubble">
                  {t.role === "user" ? (
                    t.content
                  ) : t.content ? (
                    markdown(t.content)
                  ) : (
                    <span class="dots-typing">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </div>
              </div>
            ))}

            {turns.length === 0 && config.suggestedPrompts.length > 0 && (
              <div class="starters">
                {config.suggestedPrompts.map((p) => (
                  <button class="starter" key={p} disabled={streaming} onClick={() => send(p)}>
                    {p}
                  </button>
                ))}
              </div>
            )}

            {error && <div class="err">{error}</div>}
          </div>

          <div class="composer">
            <div class="field">
              <textarea
                rows={1}
                value={input}
                placeholder="Ask a question…"
                onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
              />
              <button
                class="send"
                disabled={!input.trim() || streaming}
                aria-label="Send"
                onClick={() => send(input)}
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M8 13V3M4 7l4-4 4 4" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </div>
            <p class="foot">AI · can be imperfect</p>
          </div>
        </div>
      </div>

      <div class="launcher-layer">
        <button
          ref={launcherRef}
          class="launcher"
          data-open={String(open)}
          aria-label={`Open the ${config.name} assistant`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerEnter={() => rigRef.current?.setState({ hovered: true })}
          onPointerLeave={() => rigRef.current?.setState({ hovered: false })}
          onClick={() => {
            // Suppressed after a real drag so releasing the pet does not also open it.
            if (!drag.current.moved) openPanel();
          }}
        >
          <Pet spec={config.pet} onRig={(r) => (rigRef.current = r)} />
        </button>
      </div>
    </>
  );
}

export { configureStorage };
