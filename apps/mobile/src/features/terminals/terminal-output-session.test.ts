import { expect, test } from "bun:test";
import { TERMINAL_PROTOCOL_VERSION } from "@openducktor/contracts";
import type { TerminalFrameListener } from "@openducktor/frontend-core/terminals/terminal-transport-controller";
import type { TerminalPageInbound } from "@/rich-content/isolated-page/terminal-page-messages";
import { decodeBase64 } from "@/rich-content/isolated-page/terminal-bytes";
import { createTerminalOutputSession } from "./terminal-output-session";

const setup = () => {
  const calls: string[] = [];
  const posted: TerminalPageInbound[] = [];
  let listener: TerminalFrameListener | null = null;
  let frame: ((time: number) => void) | null = null;
  const transport = {
    subscribe: (_terminalId: string, next: TerminalFrameListener) => {
      calls.push("subscribe");
      listener = next;
      return () => {
        calls.push("unsubscribe");
        listener = null;
      };
    },
    acknowledge: async (_terminalId: string, sequenceEnd: number) => {
      calls.push(`ack:${sequenceEnd}`);
    },
    releaseEmulator: () => {
      calls.push("release");
    },
    write: async () => {
      calls.push("write");
    },
    resize: async () => {
      calls.push("resize");
    },
  };
  const session = createTerminalOutputSession({
    terminalId: "action",
    transport,
    frames: {
      requestFrame: (callback) => {
        frame = callback;
        return 1;
      },
      cancelFrame: () => {
        frame = null;
      },
    },
    onNotice: (notice) => calls.push(notice),
    onCopy: (text) => calls.push(`copy:${text}`),
  });
  return {
    session,
    calls,
    posted,
    attach: () => session.attachPage((message) => posted.push(message)),
    emit: (text: string) =>
      listener?.(
        {
          version: TERMINAL_PROTOCOL_VERSION,
          type: "output",
          terminalId: "action",
          sequenceStart: 0,
          sequenceEnd: text.length,
          replay: false,
        },
        new TextEncoder().encode(text),
      ),
    draw: () => {
      const draw = frame;
      frame = null;
      draw?.(16);
    },
  };
};

test("startup output acknowledges parsed bytes and never sends input or grid changes", async () => {
  const view = setup();
  view.attach();
  view.emit("setup output");
  expect(view.calls).toEqual(["subscribe"]);
  view.draw();
  const output = view.posted[0];
  if (output?.type !== "terminal_output") throw new Error("Expected terminal output.");
  expect(new TextDecoder().decode(decodeBase64(output.chunks[0]!.bytes))).toBe("setup output");
  view.session.receive({ type: "terminal_input", data: "rm file\r" });
  view.session.receive({ type: "terminal_resize", columns: 20, rows: 8 });
  view.session.receive({ type: "terminal_consumed", sequenceEnd: 12 });
  view.session.receive({ type: "terminal_copy", text: "setup output" });
  await Promise.resolve();
  expect(view.calls).toEqual(["subscribe", "ack:12", "copy:setup output"]);
  view.session.dispose();
});

test("startup output releases its cursor before detaching and drops queued page output", () => {
  const view = setup();
  view.attach();
  view.emit("old page");
  view.session.detachPage();
  view.draw();
  expect(view.posted).toEqual([]);
  expect(view.calls).toEqual(["subscribe", "release", "unsubscribe"]);
  view.attach();
  view.emit("fresh replay");
  view.draw();
  expect(view.posted).toHaveLength(1);
  view.session.dispose();
  view.session.dispose();
  expect(view.calls).toEqual([
    "subscribe",
    "release",
    "unsubscribe",
    "subscribe",
    "release",
    "unsubscribe",
  ]);
});
