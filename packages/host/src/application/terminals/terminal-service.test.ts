import { beforeEach, describe, expect, test } from "bun:test";
import { posix } from "node:path";
import { Effect } from "effect";
import { createTerminalLaunchEnvironment } from "../../infrastructure/terminals/terminal-launch-environment";
import type { FilesystemPort } from "../../ports/filesystem-port";
import {
  TerminalPtyError,
  type TerminalPtyHandlers,
  type TerminalPtyPort,
} from "../../ports/terminal-pty-port";
import { TERMINAL_LIMITS } from "./terminal-limits";
import { createTerminalService } from "./terminal-service";
import type { TerminalTitleSettlementScheduler } from "./terminal-title-settler";

let directoryAvailable = true;
const filesystem: FilesystemPort = {
  homeDirectory: () => "/home/user",
  canonicalize: (path: string) => Effect.succeed(`/canonical${path}`),
  readDirectory: () => Effect.succeed([]),
  readFileBytes: () => Effect.succeed(new Uint8Array()),
  stat: () => Effect.succeed({ isDirectory: directoryAvailable }),
  exists: () => Effect.succeed(true),
  join: posix.join,
  relative: posix.relative,
  parent: (path) => (path === "/" ? null : posix.dirname(path)),
};

const makePty = (supportsOutputPause = true, hasChildProcesses = true) => {
  const operations: string[] = [];
  let handlers: TerminalPtyHandlers | null = null;
  let terminateFails = false;
  let terminateFailuresRemaining = 0;
  const port: TerminalPtyPort = {
    start: (_plan, nextHandlers) => {
      handlers = nextHandlers;
      return Effect.succeed({
        supportsOutputPause,
        hasChildProcesses: () =>
          Effect.sync(() => {
            operations.push("inspect-children");
            return hasChildProcesses;
          }),
        write: (data) =>
          Effect.sync(() => operations.push(`write:${new TextDecoder().decode(data)}`)),
        resize: (grid) => Effect.sync(() => operations.push(`resize:${grid.columns}x${grid.rows}`)),
        pauseOutput: () => Effect.sync(() => operations.push("pause")),
        resumeOutput: () => Effect.sync(() => operations.push("resume")),
        terminate: () =>
          Effect.suspend(() => {
            if (terminateFails || terminateFailuresRemaining > 0) {
              if (terminateFailuresRemaining > 0) terminateFailuresRemaining -= 1;
              return Effect.fail(
                new TerminalPtyError({
                  code: "operation_failed",
                  operation: "terminate",
                  message: "busy",
                }),
              );
            }
            return Effect.sync(() => operations.push("terminate"));
          }),
      });
    },
  };
  return {
    port,
    operations,
    emit: (data: Uint8Array) => handlers?.onOutput(data),
    exit: (exitCode: number | null = 0) => handlers?.onExit({ exitCode, signal: null }),
    failTerminate: () => {
      terminateFails = true;
    },
    failNextTerminate: () => {
      terminateFailuresRemaining += 1;
    },
  };
};

const makeTitleSettlementScheduler = () => {
  const scheduled = new Set<() => void>();
  const schedule: TerminalTitleSettlementScheduler = (_delay, settle) => {
    scheduled.add(settle);
    return () => scheduled.delete(settle);
  };
  return {
    schedule,
    flush: () => {
      const pending = [...scheduled];
      scheduled.clear();
      for (const settle of pending) settle();
    },
  };
};

const makeService = async (
  pty = makePty(),
  idFactory: () => string = () => "terminal-1",
  filesystemPort: FilesystemPort = filesystem,
) => {
  const titleSettlement = makeTitleSettlementScheduler();
  return {
    pty,
    settleTitles: titleSettlement.flush,
    service: await Effect.runPromise(
      createTerminalService({
        filesystem: filesystemPort,
        ptyPort: pty.port,
        resolveLaunchEnvironment: createTerminalLaunchEnvironment({
          processEnv: { SHELL: "/bin/zsh", PATH: "/usr/bin" },
          platform: "darwin",
        }),
        idFactory,
        hostInstanceIdFactory: () => "host-1",
        now: () => new Date("2026-07-12T00:00:00.000Z"),
        scheduleTitleSettlement: titleSettlement.schedule,
      }),
    ),
  };
};

describe("TerminalService", () => {
  beforeEach(() => {
    directoryAvailable = true;
  });
  test("creates a taskless terminal and keeps its canonical initial directory immutable", async () => {
    const { service, pty } = await makeService();
    const created = await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    expect(created.summary.label).toBe("/canonical/repo");
    await Effect.runPromise(
      service.write(created.ref.terminalId, new TextEncoder().encode("cd /tmp\n")),
    );
    const listed = await Effect.runPromise(service.list({ kind: "unassociated" }));
    expect(listed.terminals[0]?.initialWorkingDir).toBe("/canonical/repo");
    expect(pty.operations).toContain("write:cd /tmp\n");
  });

  test("lists the latest terminal title without changing the initial directory", async () => {
    const { service, pty, settleTitles } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));

    pty.emit(new TextEncoder().encode("\u001b]0;user@host:~/projects/openducktor\u0007"));
    settleTitles();

    const listed = await Effect.runPromise(service.list({ kind: "unassociated" }));
    expect(listed.terminals[0]).toMatchObject({
      label: "~/projects/openducktor",
      initialWorkingDir: "/canonical/repo",
    });

    pty.emit(new TextEncoder().encode("\u001b]2;pnpm "));
    pty.emit(new TextEncoder().encode("run dev\u001b\\"));
    settleTitles();

    const updated = await Effect.runPromise(service.list({ kind: "unassociated" }));
    expect(updated.terminals[0]?.label).toBe("pnpm run dev");
  });

  test("publishes the current title on attach and later title changes as metadata", async () => {
    const { service, pty, settleTitles } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    pty.emit(new TextEncoder().encode("\u001b]0;user@host:~/repo\u0007"));
    settleTitles();
    const events: unknown[] = [];

    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "attachment-1",
        lastConsumedSequence: 0,
        sink: (event) => events.push(event),
      }),
    );

    expect(events[0]).toMatchObject({ type: "snapshot", title: "~/repo" });

    pty.emit(new TextEncoder().encode("\u001b]2;pnpm run dev\u0007"));
    settleTitles();
    expect(events).toContainEqual(
      expect.objectContaining({ type: "title", title: "pnpm run dev" }),
    );
  });

  test("publishes only the settled title for a fast shell command", async () => {
    const { service, pty, settleTitles } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    const events: Array<{ type: string; title?: string }> = [];

    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "attachment-1",
        lastConsumedSequence: 0,
        sink: (event) => events.push(event),
      }),
    );

    pty.emit(new TextEncoder().encode("\u001b]2;cd /tmp\u0007"));
    pty.emit(new TextEncoder().encode("\u001b]0;user@host:/tmp\u0007"));

    settleTitles();

    expect(events.filter((event) => event.type === "title")).toEqual([
      expect.objectContaining({ type: "title", title: "/tmp" }),
    ]);
  });

  test("cancels an unsettled title when the terminal closes", async () => {
    const { service, pty, settleTitles } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    const events: Array<{ type: string }> = [];
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "attachment-1",
        lastConsumedSequence: 0,
        sink: (event) => events.push(event),
      }),
    );

    pty.emit(new TextEncoder().encode("\u001b]2;pnpm run dev\u0007"));
    await Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: true }));
    settleTitles();

    expect(events.some((event) => event.type === "title")).toBe(false);
  });

  test("publishes output before exit with monotonic byte ranges", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(
      service.create({
        workingDir: "/repo",
        context: { repoPath: "/repo", taskId: "task-1" },
      }),
    );
    const events: Array<{ type: string; start?: number; end?: number }> = [];
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "attachment-1",
        lastConsumedSequence: 0,
        sink: (event) => {
          if (event.type === "output") {
            events.push({ type: event.type, start: event.sequenceStart, end: event.sequenceEnd });
            return;
          }
          events.push({ type: event.type });
        },
      }),
    );
    pty.emit(new Uint8Array([1, 2]));
    pty.emit(new Uint8Array([3]));
    pty.exit(7);
    expect(events.filter((event) => event.type === "output")).toEqual([
      { type: "output", start: 0, end: 2 },
      { type: "output", start: 2, end: 3 },
    ]);
    expect(events.at(-1)?.type).toBe("lifecycle");
  });

  test("preserves input and resize barriers", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await Effect.runPromise(
      Effect.all(
        [
          service.write("terminal-1", new TextEncoder().encode("first")),
          service.resize("terminal-1", { columns: 120, rows: 40 }),
          service.write("terminal-1", new TextEncoder().encode("second")),
        ],
        { concurrency: "unbounded" },
      ),
    );
    expect(pty.operations).toEqual(["write:first", "resize:120x40", "write:second"]);
  });

  test("reports an exact replay gap before the retained tail", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    pty.emit(new Uint8Array(TERMINAL_LIMITS.replayBytes + 1));
    const eventTypes: string[] = [];
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "attachment-1",
        lastConsumedSequence: 0,
        sink: (event) => eventTypes.push(event.type),
      }),
    );
    expect(eventTypes[0]).toBe("snapshot");
    expect(eventTypes[1]).toBe("replay_gap");
    expect(eventTypes[2]).toBe("output");
  });

  test("rejects an attachment position beyond published output", async () => {
    const { service } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await expect(
      Effect.runPromise(
        service.attach({
          terminalId: "terminal-1",
          attachmentId: "future",
          lastConsumedSequence: 1,
          sink: () => undefined,
        }),
      ),
    ).rejects.toThrow("beyond the published sequence");
  });

  test("rolls back an attachment when its initial sink throws", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    let sinkCalls = 0;

    await expect(
      Effect.runPromise(
        service.attach({
          terminalId: "terminal-1",
          attachmentId: "broken-renderer",
          lastConsumedSequence: 0,
          sink: () => {
            sinkCalls += 1;
            throw new Error("socket closed");
          },
        }),
      ),
    ).rejects.toThrow("socket closed");

    pty.emit(new Uint8Array([1]));
    expect(sinkCalls).toBe(1);
  });

  test("isolates a stale attachment while continuing output delivery", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    let staleSinkShouldThrow = false;
    const healthyEvents: string[] = [];

    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "stale-renderer",
        lastConsumedSequence: 0,
        sink: () => {
          if (staleSinkShouldThrow) throw new Error("renderer destroyed");
        },
      }),
    );
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "healthy-renderer",
        lastConsumedSequence: 0,
        sink: (event) => healthyEvents.push(event.type),
      }),
    );

    staleSinkShouldThrow = true;
    expect(() => pty.emit(new Uint8Array([1]))).not.toThrow();
    expect(healthyEvents).toEqual(["snapshot", "output"]);

    pty.emit(new Uint8Array([2]));
    expect(healthyEvents).toEqual(["snapshot", "output", "output"]);
  });

  test("lists terminals without repeating filesystem validation", async () => {
    let statCalls = 0;
    const countingFilesystem: FilesystemPort = {
      ...filesystem,
      stat: (path) => {
        statCalls += 1;
        return filesystem.stat(path);
      },
    };
    const { service } = await makeService(makePty(), () => "terminal-1", countingFilesystem);
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    const callsAfterCreate = statCalls;
    await Effect.runPromise(service.list({ kind: "all" }));
    expect(statCalls).toBe(callsAfterCreate);
  });

  test("does not advance pending output until ACK and pauses at the hard bound", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "a",
        lastConsumedSequence: 0,
        sink: () => undefined,
      }),
    );
    pty.emit(new Uint8Array(TERMINAL_LIMITS.pendingOutputBytes));
    await Bun.sleep(0);
    expect(pty.operations).toContain("pause");
    await Effect.runPromise(
      service.acknowledge("terminal-1", "a", TERMINAL_LIMITS.pendingOutputBytes),
    );
    expect(pty.operations).toContain("resume");
  });

  test("resumes output when the pressure-causing attachment detaches", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "slow-renderer",
        lastConsumedSequence: 0,
        sink: () => undefined,
      }),
    );
    pty.emit(new Uint8Array(TERMINAL_LIMITS.pendingOutputBytes));
    await Bun.sleep(0);

    await Effect.runPromise(service.detach("terminal-1", "slow-renderer"));

    expect(pty.operations).toEqual(["pause", "resume"]);
    const replayed: string[] = [];
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "replacement-renderer",
        lastConsumedSequence: TERMINAL_LIMITS.pendingOutputBytes,
        sink: (event) => replayed.push(event.type),
      }),
    );
    expect(replayed).toEqual(["snapshot"]);
  });

  test("resumes output when a failed sink removes the last attachment", async () => {
    const { service, pty, settleTitles } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "closing-renderer",
        lastConsumedSequence: 0,
        sink: (event) => {
          if (event.type === "title") throw new Error("renderer destroyed");
        },
      }),
    );
    const titleSequence = new TextEncoder().encode("\u001b]2;pnpm run dev\u0007");
    pty.emit(titleSequence);
    pty.emit(new Uint8Array(TERMINAL_LIMITS.pendingOutputBytes - titleSequence.byteLength));
    await Bun.sleep(0);
    expect(pty.operations).toEqual(["pause"]);

    settleTitles();
    await Bun.sleep(0);

    expect(pty.operations).toEqual(["pause", "resume"]);
  });

  test("terminates with overflow when output pause is unsupported", async () => {
    let id = 0;
    const { service, pty } = await makeService(makePty(false), () => `terminal-${++id}`);
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    const events: string[] = [];
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "a",
        lastConsumedSequence: 0,
        sink: (event) => events.push(event.type),
      }),
    );
    pty.emit(new Uint8Array(TERMINAL_LIMITS.pendingOutputBytes + 1));
    await Bun.sleep(0);
    expect(events).toContain("output_overflow");
    expect(pty.operations).toContain("terminate");
    const listed = await Effect.runPromise(service.list({ kind: "all" }));
    expect(listed.terminals[0]?.lifecycle).toBe("exited");
    for (let index = 0; index < TERMINAL_LIMITS.livePerHost; index += 1) {
      await Effect.runPromise(
        service.create({
          workingDir: "/repo",
          context: { repoPath: "/repo", taskId: `replacement-${index}` },
        }),
      );
    }
  });

  test("requires confirmation and keeps close failures retryable", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await expect(
      Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: false })),
    ).rejects.toThrow();
    pty.failTerminate();
    await expect(
      Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: true })),
    ).rejects.toThrow();
    const listed = await Effect.runPromise(service.list({ kind: "all" }));
    expect(listed.terminals[0]?.lifecycle).toBe("close_failed");
  });

  test("closes an idle shell without confirmation", async () => {
    const { service, pty } = await makeService(makePty(true, false));
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));

    await Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: false }));

    expect((await Effect.runPromise(service.list({ kind: "all" }))).terminals).toEqual([]);
    expect(pty.operations).toEqual(["inspect-children", "terminate"]);
  });

  test("scopes task cleanup by repository and forgets attached terminals", async () => {
    let terminalId = 0;
    const { service } = await makeService(makePty(true, false), () => `terminal-${++terminalId}`);
    await Effect.runPromise(
      service.create({
        workingDir: "/repo-a",
        context: { repoPath: "/repo-a", taskId: "shared-task" },
      }),
    );
    await Effect.runPromise(
      service.create({
        workingDir: "/repo-b",
        context: { repoPath: "/repo-b", taskId: "shared-task" },
      }),
    );
    const events: string[] = [];
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "renderer",
        lastConsumedSequence: 0,
        sink: (event) => events.push(event.type),
      }),
    );

    await Effect.runPromise(
      Effect.scoped(service.acquireTaskCleanup({ repoPath: "/repo-a", taskIds: ["shared-task"] })),
    );

    expect(events.at(-1)).toBe("terminal_forgotten");
    expect(
      (
        await Effect.runPromise(
          service.list({ kind: "task", repoPath: "/repo-a", taskId: "shared-task" }),
        )
      ).terminals,
    ).toEqual([]);
    expect(
      (
        await Effect.runPromise(
          service.list({ kind: "task", repoPath: "/repo-b", taskId: "shared-task" }),
        )
      ).terminals.map((terminal) => terminal.terminalId),
    ).toEqual(["terminal-2"]);
  });

  test("removes a close-failed session after its PTY cleanup retry succeeds", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    pty.failNextTerminate();

    await expect(
      Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: true })),
    ).rejects.toThrow();
    expect((await Effect.runPromise(service.list({ kind: "all" }))).terminals[0]?.lifecycle).toBe(
      "close_failed",
    );

    await Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: true }));

    expect((await Effect.runPromise(service.list({ kind: "all" }))).terminals).toEqual([]);
    expect(pty.operations).toContain("terminate");
  });

  test("keeps tracking titles while a failed close remains retryable", async () => {
    const { service, pty, settleTitles } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    pty.failNextTerminate();

    await expect(
      Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: true })),
    ).rejects.toThrow();

    pty.emit(new TextEncoder().encode("\u001b]0;user@host:~/still-running\u0007"));
    settleTitles();

    const listed = await Effect.runPromise(service.list({ kind: "all" }));
    expect(listed.terminals[0]).toMatchObject({
      label: "~/still-running",
      lifecycle: "close_failed",
    });

    await Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: true }));
    expect((await Effect.runPromise(service.list({ kind: "all" }))).terminals).toEqual([]);
  });

  test("terminates independent sessions concurrently during host shutdown", async () => {
    let terminalId = 0;
    let startedTerminations = 0;
    let releaseTerminations = (): void => undefined;
    const terminationsReleased = new Promise<void>((resolve) => {
      releaseTerminations = resolve;
    });
    const pty = makePty();
    pty.port.start = () =>
      Effect.succeed({
        supportsOutputPause: true,
        hasChildProcesses: () => Effect.succeed(false),
        write: () => Effect.void,
        resize: () => Effect.void,
        pauseOutput: () => Effect.void,
        resumeOutput: () => Effect.void,
        terminate: () =>
          Effect.promise(async () => {
            startedTerminations += 1;
            await terminationsReleased;
          }),
      });
    const { service } = await makeService(pty, () => `terminal-${++terminalId}`);
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));

    const disposing = Effect.runPromise(service.dispose());
    try {
      await Bun.sleep(0);
      expect(startedTerminations).toBe(2);
    } finally {
      releaseTerminations();
      await disposing;
    }
  });

  test("waits for an admitted creation before completing host shutdown", async () => {
    let releaseCanonicalize = (): void => undefined;
    let reportCanonicalizeStarted = (): void => undefined;
    const canonicalizeStarted = new Promise<void>((resolve) => {
      reportCanonicalizeStarted = resolve;
    });
    const canonicalizeReleased = new Promise<void>((resolve) => {
      releaseCanonicalize = resolve;
    });
    const delayedFilesystem: FilesystemPort = {
      ...filesystem,
      canonicalize: (path) =>
        Effect.promise(async () => {
          reportCanonicalizeStarted();
          await canonicalizeReleased;
          return `/canonical${path}`;
        }),
    };
    const { service, pty } = await makeService(makePty(), () => "terminal-1", delayedFilesystem);

    const creating = Effect.runPromise(
      service.create({
        workingDir: "/repo",
        context: { repoPath: "/repo", taskId: "task-1" },
      }),
    );
    await canonicalizeStarted;
    let disposed = false;
    const disposing = Effect.runPromise(service.dispose()).then(() => {
      disposed = true;
    });

    await Bun.sleep(0);
    expect(disposed).toBe(false);
    releaseCanonicalize();
    await creating;
    await disposing;

    expect(pty.operations).toContain("terminate");
    expect((await Effect.runPromise(service.list({ kind: "all" }))).terminals).toEqual([]);
  });

  test("reserves task capacity across concurrent terminal creation", async () => {
    let canonicalizeCount = 0;
    let releaseCanonicalize = (): void => undefined;
    let reportAllCanonicalizing = (): void => undefined;
    const allCanonicalizing = new Promise<void>((resolve) => {
      reportAllCanonicalizing = resolve;
    });
    const canonicalizeReleased = new Promise<void>((resolve) => {
      releaseCanonicalize = resolve;
    });
    const delayedFilesystem: FilesystemPort = {
      ...filesystem,
      canonicalize: (path) =>
        Effect.promise(async () => {
          canonicalizeCount += 1;
          if (canonicalizeCount === TERMINAL_LIMITS.livePerTask) reportAllCanonicalizing();
          await canonicalizeReleased;
          return `/canonical${path}`;
        }),
    };
    let terminalId = 0;
    const { service } = await makeService(
      makePty(),
      () => `terminal-${++terminalId}`,
      delayedFilesystem,
    );

    const creations = Array.from({ length: TERMINAL_LIMITS.livePerTask + 1 }, () =>
      Effect.runPromise(
        Effect.either(
          service.create({
            workingDir: "/repo",
            context: { repoPath: "/repo", taskId: "task-1" },
          }),
        ),
      ),
    );
    await allCanonicalizing;
    releaseCanonicalize();
    const results = await Promise.all(creations);

    expect(results.filter((result) => result._tag === "Right")).toHaveLength(
      TERMINAL_LIMITS.livePerTask,
    );
    expect(results.filter((result) => result._tag === "Left")).toHaveLength(1);
    expect(results.find((result) => result._tag === "Left")?.left.code).toBe(
      "context_terminal_limit",
    );
  });

  test("holds task admission closed while scoped cleanup is active", async () => {
    let releaseCanonicalize = (): void => undefined;
    let reportCanonicalizeStarted = (): void => undefined;
    const canonicalizeStarted = new Promise<void>((resolve) => {
      reportCanonicalizeStarted = resolve;
    });
    const canonicalizeReleased = new Promise<void>((resolve) => {
      releaseCanonicalize = resolve;
    });
    let shouldDelayCanonicalize = true;
    const delayedFilesystem: FilesystemPort = {
      ...filesystem,
      canonicalize: (path) =>
        Effect.promise(async () => {
          if (shouldDelayCanonicalize) {
            reportCanonicalizeStarted();
            await canonicalizeReleased;
          }
          return `/canonical${path}`;
        }),
    };
    let terminalId = 0;
    const { service } = await makeService(
      makePty(),
      () => `terminal-${++terminalId}`,
      delayedFilesystem,
    );
    const creating = Effect.runPromise(
      service.create({
        workingDir: "/repo",
        context: { repoPath: "/repo", taskId: "task-1" },
      }),
    );
    await canonicalizeStarted;
    let releaseCleanup = (): void => undefined;
    const cleanupReleased = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let reportCleanupAcquired = (): void => undefined;
    const cleanupAcquired = new Promise<void>((resolve) => {
      reportCleanupAcquired = resolve;
    });
    const cleanup = Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* service.acquireTaskCleanup({ repoPath: "/repo", taskIds: ["task-1"] });
          reportCleanupAcquired();
          yield* Effect.promise(() => cleanupReleased);
        }),
      ),
    );

    await Bun.sleep(0);
    const blocked = await Effect.runPromise(
      Effect.either(
        service.create({
          workingDir: "/repo",
          context: { repoPath: "/repo", taskId: "task-1" },
        }),
      ),
    );
    expect(blocked._tag).toBe("Left");
    if (blocked._tag === "Left") expect(blocked.left.code).toBe("close_failed");

    releaseCanonicalize();
    await creating;
    await cleanupAcquired;
    expect(
      (await Effect.runPromise(service.list({ kind: "task", repoPath: "/repo", taskId: "task-1" })))
        .terminals,
    ).toEqual([]);

    shouldDelayCanonicalize = false;
    releaseCleanup();
    await cleanup;
    const createdAfterCleanup = await Effect.runPromise(
      service.create({
        workingDir: "/repo",
        context: { repoPath: "/repo", taskId: "task-1" },
      }),
    );
    expect(createdAfterCleanup.summary.context).toEqual({ repoPath: "/repo", taskId: "task-1" });
  });
});
