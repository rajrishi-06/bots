/**
 * The tag a customer pastes:
 *
 *   <script src="https://cdn.petbot.dev/petbot.js" data-bot-id="pb_live_…"></script>
 *
 * This file is all that runs on page load. The widget itself — Preact, the pet
 * rig, the panel — is imported later, off the critical path, because a customer
 * pastes this into their marketing site and it must not cost them a metric.
 */

interface PetbotGlobal {
  mount(opts: { botKey: string; apiBase?: string }): Promise<() => void>;
  q?: unknown[];
}

declare global {
  interface Window {
    petbot?: PetbotGlobal;
  }
}

const script = document.currentScript as HTMLScriptElement | null;

function config() {
  const botKey = script?.dataset.botId ?? "";
  // API base defaults to wherever this script came from, so the common case
  // needs no configuration at all.
  const src = script?.src ?? "";
  const apiBase = script?.dataset.api ?? (src ? new URL(src).origin : "");
  const eager = script?.dataset.eager === "true";
  return { botKey, apiBase, eager };
}

/** Import the widget when the browser is idle, or on the first real intent. */
function whenIdle(fn: () => void): void {
  const ric = window.requestIdleCallback;
  if (typeof ric === "function") ric(() => fn(), { timeout: 3000 });
  else setTimeout(fn, 1200);
}

async function boot(): Promise<void> {
  const { botKey, apiBase } = config();
  if (!botKey) {
    console.warn("[petbot] missing data-bot-id on the script tag.");
    return;
  }
  try {
    // Resolved against this script's own URL so the chunk is fetched from the
    // CDN it was served from, not from the customer's origin.
    const url = new URL("./petbot.js", script?.src ?? location.href).href;
    const mod = (await import(/* @vite-ignore */ url)) as PetbotGlobal;
    await mod.mount({ botKey, apiBase });
  } catch (err) {
    // A broken embed must never put an error on a customer's page.
    console.warn("[petbot] failed to load:", err);
  }
}

const { eager } = config();
if (eager) void boot();
else if (document.readyState === "complete") whenIdle(() => void boot());
else window.addEventListener("load", () => whenIdle(() => void boot()), { once: true });

export {};
