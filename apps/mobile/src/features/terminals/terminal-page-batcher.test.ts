import { describe, expect, test } from "bun:test";
import { decodeBase64 } from "@/rich-content/isolated-page/terminal-bytes";
import { createTerminalPageBatcher } from "./terminal-page-batcher";
import type { TerminalPageInbound } from "@/rich-content/isolated-page/terminal-page-messages";
import type { TerminalFrameScheduler } from "@openducktor/frontend-core/terminals/terminal-viewport-policy";

/** A display frame clock that a test advances by hand. */
const createManualFrames = (): TerminalFrameScheduler & {
  pending(): number;
  run(): void;
} => {
  const callbacks = new Map<number, (time: number) => void>();
  let nextId = 1;
  let time = 0;
  return {
    requestFrame: (callback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancelFrame: (id) => {
      callbacks.delete(id);
    },
    pending: () => callbacks.size,
    run: () => {
      time += 16;
      const due = [...callbacks.values()];
      callbacks.clear();
      for (const callback of due) callback(time);
    },
  };
};

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (base64: string) => new TextDecoder().decode(decodeBase64(base64));

const setup = () => {
  const frames = createManualFrames();
  const posted: TerminalPageInbound[] = [];
  const batcher = createTerminalPageBatcher({ ...frames, post: (message) => posted.push(message) });
  return { frames, posted, batcher };
};

describe("createTerminalPageBatcher", () => {
  test("sends a burst of output as one message in the next display frame", () => {
    const { frames, posted, batcher } = setup();
    batcher.push({ kind: "output", sequenceStart: 0, sequenceEnd: 2, payload: bytes("ab") });
    batcher.push({ kind: "output", sequenceStart: 2, sequenceEnd: 5, payload: bytes("cde") });
    batcher.push({ kind: "output", sequenceStart: 5, sequenceEnd: 6, payload: bytes("f") });
    expect(posted).toEqual([]);
    expect(frames.pending()).toBe(1);

    frames.run();

    expect(posted).toHaveLength(1);
    const [message] = posted;
    if (message?.type !== "terminal_output") throw new Error("Expected output.");
    expect(message.chunks).toHaveLength(1);
    expect(message.chunks[0]).toMatchObject({ sequenceStart: 0, sequenceEnd: 6 });
    expect(text(message.chunks[0]?.bytes ?? "")).toBe("abcdef");
  });

  test("keeps gaps and replayed ranges as their own chunks for the page sequencer", () => {
    const { frames, posted, batcher } = setup();
    batcher.push({ kind: "output", sequenceStart: 0, sequenceEnd: 2, payload: bytes("ab") });
    batcher.push({ kind: "output", sequenceStart: 1, sequenceEnd: 3, payload: bytes("bc") });
    batcher.push({ kind: "output", sequenceStart: 9, sequenceEnd: 10, payload: bytes("z") });
    frames.run();
    const [message] = posted;
    if (message?.type !== "terminal_output") throw new Error("Expected output.");
    expect(
      message.chunks.map(({ sequenceStart, sequenceEnd }) => [sequenceStart, sequenceEnd]),
    ).toEqual([
      [0, 2],
      [1, 3],
      [9, 10],
    ]);
  });

  test("keeps host order around snapshots and screen restores", () => {
    const { frames, posted, batcher } = setup();
    batcher.push({ kind: "snapshot", sequenceEnd: 4 });
    batcher.push({ kind: "output", sequenceStart: 0, sequenceEnd: 4, payload: bytes("abcd") });
    batcher.push({
      kind: "restore",
      sequenceEnd: 10,
      columns: 80,
      rows: 24,
      precedingJoinState: 3,
      payload: bytes("screen"),
    });
    batcher.push({ kind: "output", sequenceStart: 10, sequenceEnd: 11, payload: bytes("!") });
    frames.run();
    expect(posted.map((message) => message.type)).toEqual([
      "terminal_snapshot",
      "terminal_output",
      "terminal_restore",
      "terminal_output",
    ]);
    expect(posted[2]).toMatchObject({ columns: 80, rows: 24, precedingJoinState: 3 });
    expect(frames.pending()).toBe(0);
  });

  test("drops waiting frames when the page goes away", () => {
    const { frames, posted, batcher } = setup();
    batcher.push({ kind: "output", sequenceStart: 0, sequenceEnd: 1, payload: bytes("a") });
    batcher.clear();
    frames.run();
    expect(posted).toEqual([]);
    expect(frames.pending()).toBe(0);
  });
});
