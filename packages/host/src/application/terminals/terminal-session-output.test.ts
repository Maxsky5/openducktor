import { describe, expect, test } from "bun:test";
import type { TerminalServerMessage, TerminalSummary } from "@openducktor/contracts";
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

const createOutput = (): TerminalSessionOutput =>
  new TerminalSessionOutput("terminal-1", TERMINAL_LIMITS.replayBytes, () => ({
    columns: 80,
    rows: 24,
    payload: new TextEncoder().encode("\u001b[0m"),
    precedingJoinState: 0,
  }));

describe("TerminalSessionOutput", () => {
  test("requests one resume when parser backlog falls below the resume limit", () => {
    const output = createOutput();
    expect(output.updateParserBacklog(TERMINAL_LIMITS.pendingOutputBytes, pausableHandle)).toEqual([
      { type: "pause_requested" },
    ]);
    expect(
      output.updateParserBacklog(TERMINAL_LIMITS.resumeOutputBytes + 1, pausableHandle),
    ).toEqual([]);
    expect(output.updateParserBacklog(TERMINAL_LIMITS.resumeOutputBytes, pausableHandle)).toEqual([
      { type: "resume_requested" },
    ]);
    expect(output.updateParserBacklog(TERMINAL_LIMITS.resumeOutputBytes, pausableHandle)).toEqual(
      [],
    );
  });

  test("does not resume before a pending pause starts", async () => {
    const calls: string[] = [];
    const handle: TerminalPtyHandle = {
      ...pausableHandle,
      pauseOutput: () => Effect.sync(() => calls.push("pause")),
      resumeOutput: () => Effect.sync(() => calls.push("resume")),
    };
    const output = createOutput();
    expect(output.updateParserBacklog(TERMINAL_LIMITS.pendingOutputBytes, handle)).toEqual([
      { type: "pause_requested" },
    ]);
    output.updateParserBacklog(0, handle);
    await Effect.runPromise(output.resumeIfUnblocked(handle));
    await Effect.runPromise(output.pauseIfRequested(handle));
    expect(calls).toEqual([]);
  });

  test("issues one resume after an in-flight pause and two release requests", async () => {
    const calls: string[] = [];
    const pauseStarted = Promise.withResolvers<void>();
    const finishPause = Promise.withResolvers<void>();
    const handle: TerminalPtyHandle = {
      ...pausableHandle,
      pauseOutput: () =>
        Effect.promise(async () => {
          calls.push("pause-start");
          pauseStarted.resolve();
          await finishPause.promise;
          calls.push("pause-end");
        }),
      resumeOutput: () => Effect.sync(() => calls.push("resume")),
    };
    const output = createOutput();
    output.updateParserBacklog(TERMINAL_LIMITS.pendingOutputBytes, handle);
    const pause = Effect.runPromise(output.pauseIfRequested(handle));
    await pauseStarted.promise;
    output.updateParserBacklog(0, handle);
    const firstResume = Effect.runPromise(output.resumeIfUnblocked(handle));
    const secondResume = Effect.runPromise(output.resumeIfUnblocked(handle));
    expect(calls).toEqual(["pause-start"]);
    finishPause.resolve();
    await Promise.all([pause, firstResume, secondResume]);
    expect(calls).toEqual(["pause-start", "pause-end", "resume"]);
  });

  test("restores a gap and ignores an ACK sent before restoration", () => {
    const output = new TerminalSessionOutput("terminal-1", 4, () => ({
      columns: 80,
      rows: 24,
      payload: new TextEncoder().encode("\u001b[Hlatest"),
      precedingJoinState: 2,
    }));
    output.accept(new TextEncoder().encode("12345"), null);
    const frames: TerminalServerMessage[] = [];
    output.attach(
      {
        terminalId: "terminal-1",
        attachmentId: "client",
        lastConsumedSequence: 0,
        sink: (frame) => frames.push(frame),
      },
      summary,
      null,
    );
    expect(frames.map((frame) => frame.type)).toEqual(["snapshot", "screen_restore"]);
    expect(frames[1]).toMatchObject({
      sequenceEnd: 5,
      columns: 80,
      rows: 24,
      precedingJoinState: 2,
    });
    expect(() => output.acknowledge("client", 0)).not.toThrow();
    expect(() => output.acknowledge("client", 5)).not.toThrow();
    expect(() => output.acknowledge("client", 6)).toThrow("outside the delivered sequence");
  });

  test("reports an unusable screen instead of attaching to an incorrect one", () => {
    const output = new TerminalSessionOutput("terminal-1", 4, () => {
      throw new Error(
        "Terminal screen is too large to restore. Resize the terminal and reconnect.",
      );
    });
    output.accept(new TextEncoder().encode("12345"), null);
    const frames: TerminalServerMessage[] = [];
    output.attach(
      {
        terminalId: "terminal-1",
        attachmentId: "client",
        lastConsumedSequence: 0,
        sink: (frame) => frames.push(frame),
      },
      summary,
      null,
    );
    expect(frames.map((frame) => frame.type)).toEqual(["snapshot", "protocol_error"]);
    expect(frames[1]).toMatchObject({
      failure: {
        message: "Terminal screen is too large to restore. Resize the terminal and reconnect.",
      },
    });
    expect(() => output.acknowledge("client", 5)).toThrow("Terminal attachment not found");
  });

  test("publishes and replays the latest failure", () => {
    const output = createOutput();
    const frames: TerminalServerMessage[] = [];
    const input = {
      terminalId: "terminal-1",
      attachmentId: "client",
      lastConsumedSequence: 0,
      sink: (frame: TerminalServerMessage) => frames.push(frame),
    };
    output.attach(input, summary, null);
    output.publishFailure({ code: "spawn_failed", message: "Shell failed." });
    const failure = { code: "protocol_error" as const, message: "Process cleanup failed." };
    output.publishFailure(failure);
    expect(frames.at(-1)).toMatchObject({ type: "protocol_error", failure });
    frames.length = 0;
    output.attach(input, summary, null);
    expect(frames.at(-1)).toMatchObject({ type: "protocol_error", failure });
  });

  test("continues bounded exited replay on ACK before publishing exit and failure", async () => {
    const output = createOutput();
    const bytes = new Uint8Array(TERMINAL_LIMITS.pendingOutputBytes * 2 + 1);
    output.accept(bytes, null);
    output.publishFailure({ code: "spawn_failed", message: "Shell failed." });
    const frames: TerminalServerMessage[] = [];
    let delivered = 0;
    output.attach(
      {
        terminalId: "terminal-1",
        attachmentId: "client",
        lastConsumedSequence: 0,
        sink: (frame) => {
          frames.push(frame);
          if (frame.type === "output") delivered = frame.sequenceEnd;
        },
      },
      {
        ...summary,
        lifecycle: "exited",
        exit: {
          exitCode: 1,
          signal: null,
          finalSequence: bytes.length,
          exitedAt: "2026-07-17T00:00:01.000Z",
        },
      },
      null,
    );
    for (let batch = 1; batch <= 2; batch += 1) {
      expect(delivered).toBe(TERMINAL_LIMITS.pendingOutputBytes * batch);
      expect(
        frames.some((frame) => frame.type === "lifecycle" || frame.type === "protocol_error"),
      ).toBe(false);
      output.acknowledge("client", delivered);
      expect(await Effect.runPromise(output.resumeIfUnblocked(null))).toEqual([]);
    }
    expect(delivered).toBe(bytes.length);
    expect(frames.slice(-2).map((frame) => frame.type)).toEqual(["lifecycle", "protocol_error"]);
    expect(frames.at(-2)).toMatchObject({ finalSequence: bytes.length, exitCode: 1 });
    const count = frames.length;
    output.acknowledge("client", delivered);
    await Effect.runPromise(output.resumeIfUnblocked(null));
    expect(frames).toHaveLength(count);
  });

  test("replays final output and exit details before the retained failure", () => {
    const output = createOutput();
    output.accept(new TextEncoder().encode("done"), null);
    output.publishFailure({ code: "spawn_failed", message: "Shell failed." });
    const frames: TerminalServerMessage[] = [];
    output.attach(
      {
        terminalId: "terminal-1",
        attachmentId: "late",
        lastConsumedSequence: 0,
        sink: (frame) => frames.push(frame),
      },
      {
        ...summary,
        lifecycle: "exited",
        exit: {
          exitCode: 1,
          signal: null,
          finalSequence: 4,
          exitedAt: "2026-07-17T00:00:01.000Z",
        },
      },
      null,
    );
    expect(frames.map((frame) => frame.type)).toEqual([
      "snapshot",
      "output",
      "lifecycle",
      "protocol_error",
    ]);
    expect(frames[2]).toMatchObject({
      lifecycle: "exited",
      exitCode: 1,
      signal: null,
      finalSequence: 4,
    });
  });

  test.each(["output", "lifecycle", "protocol_error"])(
    "removes a sink that fails during %s replay without restoring its old attachment",
    (failedType) => {
      const output = createOutput();
      let oldCalls = 0;
      output.attach(
        {
          terminalId: "terminal-1",
          attachmentId: "client",
          lastConsumedSequence: 0,
          sink: () => {
            oldCalls += 1;
          },
        },
        summary,
        null,
      );
      output.accept(new TextEncoder().encode("done"), null);
      output.publishFailure({ code: "spawn_failed", message: "Shell failed." });
      const callsBeforeReplacement = oldCalls;
      const delivered: string[] = [];
      const events = output.attach(
        {
          terminalId: "terminal-1",
          attachmentId: "client",
          lastConsumedSequence: 0,
          sink: (frame) => {
            delivered.push(frame.type);
            if (frame.type === failedType) throw new Error("Disconnected");
          },
        },
        {
          ...summary,
          lifecycle: "exited",
          exit: {
            exitCode: 1,
            signal: null,
            finalSequence: 4,
            exitedAt: "2026-07-17T00:00:01.000Z",
          },
        },
        null,
      );
      expect(events).toEqual([{ type: "attachments_empty" }]);
      expect(delivered.at(-1)).toBe(failedType);
      expect(() => output.acknowledge("client", 4)).toThrow("Terminal attachment not found");
      output.publishFailure({ code: "spawn_failed", message: "Still failed." });
      expect(oldCalls).toBe(callsBeforeReplacement);
    },
  );
  test.each([TERMINAL_LIMITS.pendingOutputBytes, TERMINAL_LIMITS.pendingOutputBytes + 1])(
    "requests output pause when replay attachment reaches or exceeds its pending byte bound (%d)",
    (byteCount) => {
      const output = createOutput();
      output.accept(new Uint8Array(byteCount), pausableHandle);

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
    },
  );
});
