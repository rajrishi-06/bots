import { render } from "preact";
import { h } from "preact";
import { BotClient } from "./api.js";
import { stylesheet } from "./styles.js";
import { Widget, configureStorage } from "./widget.js";

/**
 * Mount the widget into a closed shadow root.
 *
 * `closed` rather than `open`: the host page has no legitimate reason to reach
 * into the widget's DOM, and a closed root means a host script cannot rewrite
 * the panel's contents or read a visitor's conversation out of it.
 */
export interface MountOptions {
  botKey: string;
  /** API origin. Defaults to the origin the script itself was served from. */
  apiBase?: string;
  /** Where to attach. Defaults to a fresh element on <body>. */
  container?: HTMLElement;
}

export async function mount(opts: MountOptions): Promise<() => void> {
  const { botKey } = opts;
  if (!botKey) throw new Error("petbot: data-bot-id is required.");

  const apiBase = (opts.apiBase ?? "").replace(/\/$/, "");
  const client = new BotClient(apiBase, botKey);

  // Config first: the pet's palette drives the stylesheet, so there is nothing
  // sensible to paint before it arrives. A failure here is silent by design —
  // a broken embed must never put an error box on a customer's page.
  let config;
  try {
    config = await client.config();
  } catch (err) {
    console.warn("[petbot] could not load bot config:", err);
    return () => {};
  }

  configureStorage(botKey);

  const host = opts.container ?? document.createElement("div");
  if (!opts.container) document.body.appendChild(host);
  const root = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = stylesheet(config.pet.palette);
  root.appendChild(style);

  const app = document.createElement("div");
  root.appendChild(app);
  render(h(Widget, { client, config }), app);

  return () => {
    render(null, app);
    if (!opts.container) host.remove();
  };
}

export { BotClient };
export type { BotConfig } from "./api.js";
