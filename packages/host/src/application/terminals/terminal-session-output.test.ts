import { describe, expect, test } from "bun:test";
import type { TerminalSummary } from "@openducktor/contracts";
import { Effect } from "effect";
import type { TerminalPtyHandle } from "../../ports/terminal-pty-port";
import { TERMINAL_LIMITS } from "./terminal-limits";
import { TerminalSessionOutput } from "./terminal-session-output";

const summary: TerminalSummary = {
  terminalId: "terminal-1",
  label: "/repo",
  context: {},
  initialWorkingDir: "/repo",
  createdAt: "2026-07-17T00:00:00.000Z",
  lifecycle: "running",
  exit: null,
};

const pausableHandle: TerminalPtyHandle = {
  supportsOutputPause: true,
  hasChildProcesses: () => Effect.succeed(false),
  write: () => Effect.void,
  resize: () => Effect.void,
  pauseOutput: () => Effect.void,
  resumeOutput: () => Effect.void,
  terminate: () => Effect.void,
};

describe("TerminalSessionOutput", () => {
  test("requests output pause when replay attachment reaches its pending byte bound", () => {
    const output = new TerminalSessionOutput("terminal-1", TERMINAL_LIMITS.replayBytes);
    output.accept(new Uint8Array(TERMINAL_LIMITS.pendingOutputBytes + 1), pausableHandle);

    const events = output.attach(
      {
        terminalId: "terminal-1",
        attachmentId: "attachment-1",
        lastConsumedSequence: 0,
        sink: () => undefined,
      },
      summary,
      pausableHandle,
    );

    expect(events).toContainEqual({ type: "pause_requested" });
  });
});
