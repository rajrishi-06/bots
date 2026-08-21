import { REFERENCE_PET } from "@bots/core/pet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "./index.js";
import { configureStorage, loadLauncherPos, readStoredPos, saveLauncherPos } from "./position.js";

/**
 * Mounting into someone else's page. What matters here is containment: the host
 * must not be able to read the conversation or restyle the panel, and a broken
 * embed must not put anything on their page.
 */

const CONFIG = {
  name: "Acme",
  pet: REFERENCE_PET,
  greeting: "Hi — ask me anything.",
  suggestedPrompts: ["What is your refund policy?"],
  groundingMode: "strict" as const,
};

// Deliberately WITHOUT appearance/actions: a widget cached on a CDN outlives API
// versions, and an older config must degrade to defaults rather than crash.

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(CONFIG), { status: 200 })),
  );
  document.body.innerHTML = "";
  localStorage.clear();
});

afterEach(() => vi.unstubAllGlobals());

describe("mount", () => {
  it("attaches a CLOSED shadow root the host page cannot read", async () => {
    await mount({ botKey: "pb_live_x", apiBase: "https://api.test" });
    const host = document.body.lastElementChild as HTMLElement;
    expect(host).toBeTruthy();
    // A closed root means host scripts cannot reach the conversation through
    // element.shadowRoot — which is exactly what an open root would allow.
    expect(host.shadowRoot).toBeNull();
  });

  it("leaves nothing on the page when the bot cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = document.body.childElementCount;
    const unmount = await mount({ botKey: "pb_live_x", apiBase: "https://api.test" });
    // A failed embed must be invisible on a customer's site, never an error box.
    expect(document.body.childElementCount).toBe(before);
    expect(warn).toHaveBeenCalled();
    unmount();
    warn.mockRestore();
  });

  it("refuses to mount without a bot key", async () => {
    await expect(mount({ botKey: "" })).rejects.toThrow(/data-bot-id/);
  });

  it("removes everything it added on unmount", async () => {
    const unmount = await mount({ botKey: "pb_live_x", apiBase: "https://api.test" });
    expect(document.body.childElementCount).toBe(1);
    unmount();
    expect(document.body.childElementCount).toBe(0);
  });

  it("mounts into a supplied container without taking it over", async () => {
    const container = document.createElement("div");
    container.id = "mine";
    document.body.appendChild(container);
    const unmount = await mount({ botKey: "pb_live_x", apiBase: "https://api.test", container });
    unmount();
    // The caller's element is theirs — unmount clears the widget, not the node.
    expect(document.getElementById("mine")).toBe(container);
  });
});

describe("launcher position storage", () => {
  it("namespaces per bot, so two embeds on one page do not fight", () => {
    configureStorage("pb_live_a");
    saveLauncherPos({ x: 100, y: 200 });
    expect(readStoredPos()).toEqual({ x: 100, y: 200 });

    configureStorage("pb_live_b");
    expect(readStoredPos()).toBeNull();
    saveLauncherPos({ x: 10, y: 20 });

    configureStorage("pb_live_a");
    expect(readStoredPos()).toEqual({ x: 100, y: 200 });
  });

  it("keeps the unclamped intent while showing a clamped position", () => {
    configureStorage("pb_live_c");
    saveLauncherPos({ x: 5000, y: 5000 });
    // Display clamps into the small viewport...
    const shown = loadLauncherPos(400, 400);
    expect(shown.x).toBeLessThan(400);
    // ...but the stored intent survives, so growing the window restores it.
    expect(readStoredPos()).toEqual({ x: 5000, y: 5000 });
    expect(loadLauncherPos(6000, 6000)).toEqual({ x: 5000, y: 5000 });
  });

  it("falls back to the bottom-right corner for a first-time visitor", () => {
    configureStorage("pb_live_fresh");
    const p = loadLauncherPos(1000, 800);
    expect(p.x).toBeGreaterThan(800);
    expect(p.y).toBeGreaterThan(600);
  });
});

describe("config normalisation", () => {
  it("renders with a config that predates appearance and actions", async () => {
    // CONFIG above has neither field — this is the compatibility case.
    const unmount = await mount({ botKey: "pb_live_x", apiBase: "https://api.test" });
    expect(document.body.childElementCount).toBe(1);
    unmount();
  });

  it("drops an unsafe action rather than refusing to load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...CONFIG,
            actions: [
              { id: "bad", label: "x", kind: "link", value: "javascript:alert(1)" },
              { id: "ok", label: "Docs", kind: "link", value: "https://acme.test" },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const unmount = await mount({ botKey: "pb_live_x", apiBase: "https://api.test" });
    expect(document.body.childElementCount).toBe(1);
    unmount();
  });
});
