import { describe, expect, spyOn, test } from "bun:test";
import type { TerminalSummary } from "@openducktor/contracts";
import { Effect } from "effect";
import type { TerminalPtyHandle } from "../../ports/terminal-pty-port";
import {
  activateTerminalSession,
  beginTerminalClose,
  createTerminalSession,
  exitTerminalSession,
  forgetTerminalSession,
  markTerminalCloseFailed,
} from "./terminal-session";

const summary = (): TerminalSummary => ({
  terminalId: "terminal-1",
  label: "/repo",
  context: {},
  initialWorkingDir: "/repo",
  createdAt: "2026-07-17T00:00:00.000Z",
  lifecycle: "starting",
  exit: null,
});

const handle: TerminalPtyHandle = {
  supportsOutputPause: false,
  hasChildProcesses: () => Effect.succeed(false),
  write: () => Effect.void,
  resize: () => Effect.void,
  pauseOutput: () => Effect.void,
  resumeOutput: () => Effect.void,
  terminate: () => Effect.void,
};

const makeSession = async () => {
  let disposeCalls = 0;
  const session = createTerminalSession({
    summary: summary(),
    titleTracker: {
      consume: () => undefined,
      dispose: () => {
        disposeCalls += 1;
      },
    },
    operations: await Effect.runPromise(Effect.makeSemaphore(1)),
    replayByteLimit: 1024,
    shell: "/bin/zsh",
    grid: { columns: 80, rows: 24 },
  });
  return { session, disposeCalls: () => disposeCalls };
};

describe("TerminalSession", () => {
  test("keeps failed-close resources live and finalizes them exactly once", async () => {
    const { session, disposeCalls } = await makeSession();

    expect(activateTerminalSession(session, handle)).toBe(true);
    beginTerminalClose(session);
    markTerminalCloseFailed(session);

    expect(session.summary.lifecycle).toBe("close_failed");
    expect(session.resources.handle).toBe(handle);

    const disposeScreen = spyOn(session.screen, "dispose");
    forgetTerminalSession(session);
    forgetTerminalSession(session);
    await session.screen.drained();

    expect(disposeCalls()).toBe(1);
    expect(disposeScreen).toHaveBeenCalledTimes(1);
    expect(session.resources.handle).toBeNull();
    disposeScreen.mockRestore();
  });

  test("does not reactivate a session that exited while its PTY was starting", async () => {
    const { session, disposeCalls } = await makeSession();

    expect(
      exitTerminalSession(session, {
        exitCode: 0,
        signal: null,
        exitedAt: "2026-07-17T00:00:01.000Z",
      }),
    ).toBe(true);
    expect(activateTerminalSession(session, handle)).toBe(false);

    expect(session.summary.lifecycle).toBe("exited");
    expect(session.resources.handle).toBeNull();
    expect(disposeCalls()).toBe(1);
    expect(() => session.screen.snapshot()).not.toThrow();
  });
});
