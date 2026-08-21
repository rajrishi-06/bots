import { describe, expect, it, vi } from "vitest";
import { BotClient, StreamError } from "./api.js";

/**
 * The SSE parser. Carried over from the portfolio, and the framing edge cases
 * are the whole reason it is worth testing: a network chunk boundary lands
 * wherever it lands, not on a frame boundary.
 */

function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const collect = async (chunks: string[]) => {
  const out: string[] = [];
  const done: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamOf(chunks)));
  const client = new BotClient("", "pb_live_x");
  await client.chat("hi", [], { onDelta: (t) => out.push(t), onDone: (i) => done.push(i) });
  return { text: out.join(""), done };
};

describe("consumeSSE", () => {
  it("reads whole frames", async () => {
    const { text } = await collect([
      'data: {"type":"delta","text":"Hello "}\n\n',
      'data: {"type":"delta","text":"world"}\n\n',
      'data: {"type":"done"}\n\n',
    ]);
    expect(text).toBe("Hello world");
  });

  it("reassembles a frame split across network chunks", async () => {
    // The case that breaks naive parsers: the JSON is cut mid-object.
    const { text } = await collect([
      'data: {"type":"del',
      'ta","text":"split"}\n\n',
      'data: {"type":"done"}\n\n',
    ]);
    expect(text).toBe("split");
  });

  it("handles several frames arriving in one chunk", async () => {
    const { text } = await collect([
      'data: {"type":"delta","text":"a"}\n\ndata: {"type":"delta","text":"b"}\n\ndata: {"type":"done"}\n\n',
    ]);
    expect(text).toBe("ab");
  });

  it("surfaces the done frame's payload, so citations reach the caller", async () => {
    const { done } = await collect([
      'data: {"type":"delta","text":"x [c1]"}\n\n',
      'data: {"type":"done","citations":["c1"]}\n\n',
    ]);
    expect(done[0]).toMatchObject({ citations: ["c1"] });
  });

  it("throws the server's message on an in-band error frame", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamOf(['data: {"type":"error","message":"quota"}\n\n'])));
    const client = new BotClient("", "k");
    await expect(client.chat("hi", [], { onDelta: () => {} })).rejects.toThrow(/quota/);
  });

  it("prefers the server's JSON error over a bare status code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Not authorised for this origin." }), { status: 403 })),
    );
    const client = new BotClient("", "k");
    await expect(client.chat("hi", [], { onDelta: () => {} })).rejects.toThrow(/Not authorised/);
  });

  it("ignores malformed frames rather than aborting the stream", async () => {
    const { text } = await collect([
      "data: not json\n\n",
      ": a comment line\n\n",
      'data: {"type":"delta","text":"survived"}\n\n',
      'data: {"type":"done"}\n\n',
    ]);
    expect(text).toBe("survived");
  });

  it("is a StreamError, so callers can tell it from a programming bug", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    const client = new BotClient("", "k");
    await expect(client.chat("hi", [], { onDelta: () => {} })).rejects.toBeInstanceOf(StreamError);
  });
});
