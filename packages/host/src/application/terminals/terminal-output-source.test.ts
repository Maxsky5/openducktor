import { describe, expect, test } from "bun:test";
import { posix } from "node:path";
import {
  repoConfigSchema,
  type TerminalActivityMessage,
  type TerminalServerMessage,
} from "@openducktor/contracts";
import { Terminal } from "@xterm/headless";
import { Effect, Fiber } from "effect";
import { createDevServerService } from "../dev-servers/dev-server-service";
import { HostOperationError } from "../../effect/host-errors";
import type {
  DevServerProcessPort,
  DevServerProcessStartInput,
} from "../../ports/dev-server-process-port";
import type { FilesystemPort } from "../../ports/filesystem-port";
import type { TerminalProducerHandle } from "../../ports/terminal-pty-port";
import {
  createGitPortTestDouble,
  createWorkspaceSettingsServiceTestDouble,
} from "../../test-support/service-test-doubles";
import { TERMINAL_LIMITS } from "./terminal-limits";
import { createTerminalService } from "./terminal-service";
import { GithubProviderAdapter } from "../../adapters/git-providers/github/provider-adapter";
import { createToolDiscoveryAdapter } from "../../adapters/system/tool-discovery";
import { createGitProviderResolver } from "../git/git-provider-resolver";
import {
  createBuildSettingsConfig,
  createDirectMergeGitPort,
  createPullRequestSyncSystemCommands,
  createTaskService,
  githubPullResponsePayload,
  task,
} from "../tasks/test-support/task-workflow-harness";

const unused = () => Effect.die("Unexpected target or shell operation in output source test.");
const filesystem: FilesystemPort = {
  homeDirectory: () => null,
  canonicalize: (path) => Effect.succeed(path),
  readDirectory: unused,
  readFileBytes: unused,
  readFileSnapshot: unused,
  replaceFileBytes: unused,
  stat: unused,
  exists: unused,
  join: posix.join,
  relative: posix.relative,
  parent: posix.dirname,
};
const context = { repoPath: "/repo", taskId: "task" };
const owner = { kind: "task" as const, taskId: "task" };
const command = { repoPath: "/repo", owner };
const encoder = new TextEncoder();
const makeService = async (now = () => new Date()) => {
  let id = 0;
  return Effect.runPromise(
    createTerminalService({
      filesystem,
      git: createGitPortTestDouble({}),
      taskWorktrees: { getTaskWorktree: unused },
      workspaceSessions: { settings: { getRepoConfig: unused }, store: { get: unused } },
      ptyPort: { start: unused },
      resolveLaunchEnvironment: unused,
      idFactory: () => `output-${++id}`,
      now,
    }),
  );
};
const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 500 && !condition(); attempt += 1) await Bun.sleep(2);
  expect(condition()).toBe(true);
};
const makeHandle = () => {
  const operations: string[] = [];
  let paused = false;
  const handle: TerminalProducerHandle = {
    supportsOutputPause: true,
    pauseOutput: () =>
      Effect.sync(() => {
        paused = true;
        operations.push("pause");
      }),
    resumeOutput: () =>
      Effect.sync(() => {
        paused = false;
        operations.push("resume");
      }),
    terminate: () =>
      Effect.sync(() => {
        operations.push("terminate");
      }),
  };
  return { handle, operations, isPaused: () => paused };
};

describe("shared terminal output sources", () => {
  test("publishes the started dev server command and owner until exit or release", async () => {
    const service = await makeService();
    const native = makeHandle();
    const messages: TerminalActivityMessage[] = [];
    const stop = await Effect.runPromise(
      service.observeActivity((message) => messages.push(message)),
    );
    try {
      const source = await Effect.runPromise(
        service.openOutputSource({
          context,
          workingDir: "/repo/worktree",
          label: "Web app",
          command: "bun run dev --port 3000",
          onForgotten: () => {},
        }),
      );
      expect(messages.at(-1)).toMatchObject({
        type: "activity_updated",
        activity: {
          kind: "dev_server",
          command: "bun run dev --port 3000",
          summary: { context, lifecycle: "starting" },
        },
      });
      await Effect.runPromise(source.activate(native.handle));
      expect(messages.at(-1)).toMatchObject({
        type: "activity_updated",
        activity: { summary: { lifecycle: "running" } },
      });
      expect((await Effect.runPromise(service.list({ kind: "all" }))).terminals).toEqual([]);
      const count = messages.length;
      source.write(encoder.encode("server ready\r\n"));
      expect(messages).toHaveLength(count);
      expect(native.operations).toEqual([]);
      source.exit({ exitCode: 0, signal: null });
      expect(messages.at(-1)).toMatchObject({
        type: "activity_removed",
        terminalId: source.terminalId,
      });
      source.release();
      const next: TerminalActivityMessage[] = [];
      const stopNext = await Effect.runPromise(
        service.observeActivity((message) => next.push(message)),
      );
      stopNext();
      expect(next.map((message) => message.type)).toEqual([
        "activity_snapshot_start",
        "activity_snapshot_end",
      ]);
    } finally {
      stop();
      await Effect.runPromise(service.dispose());
    }
  });

  test("restores the screen after replay eviction without exposing alternate-screen logs", async () => {
    const service = await makeService();
    const native = makeHandle();
    const source = await Effect.runPromise(
      service.openOutputSource({
        context,
        workingDir: "/repo",
        label: "Nx",
        command: "bun run dev",
        onForgotten: () => {},
      }),
    );
    const frames: Array<{ message: TerminalServerMessage; payload: Uint8Array }> = [];
    const renderer = new Terminal({ cols: 80, rows: 24, convertEol: true, allowProposedApi: true });
    try {
      await Effect.runPromise(service.resize(source.terminalId, { columns: 100, rows: 30 }));
      await Effect.runPromise(source.activate(native.handle));
      source.write(encoder.encode("\u001b[?1049h"));
      const block = encoder.encode(
        "\r\u001b[2Kinternal nx log with enough text to evict replay\n".repeat(2048),
      );
      let bytes = 8;
      while (bytes <= TERMINAL_LIMITS.replayBytes + block.byteLength) {
        await waitFor(() => !native.isPaused());
        source.write(block);
        bytes += block.byteLength;
        await Bun.sleep(0);
      }
      await waitFor(() => !native.isPaused());
      source.write(encoder.encode("\u001b[?1049lready\n"));
      source.exit({ exitCode: 0, signal: null });
      source.write(encoder.encode("late output after exit"));
      await Effect.runPromise(service.resize(source.terminalId, { columns: 90, rows: 20 }));
      await Effect.runPromise(
        service.attach({
          terminalId: source.terminalId,
          attachmentId: "renderer",
          lastConsumedSequence: 0,
          sink: (message, payload = new Uint8Array()) => {
            frames.push({ message, payload });
            return true;
          },
        }),
      );
      const restore = frames.find((frame) => frame.message.type === "screen_restore");
      expect(restore?.message).toMatchObject({ columns: 90, rows: 20 });
      if (!restore) throw new Error("Expected a screen restore after replay eviction.");
      renderer.resize(90, 20);
      await new Promise<void>((resolve) => renderer.write(restore.payload, resolve));
      const normal = renderer.buffer.normal;
      const text = Array.from({ length: normal.length }, (_, index) =>
        normal.getLine(index)?.translateToString(true),
      ).join("\n");
      expect(text).toContain("ready");
      expect(text).not.toContain("internal nx log");
      expect(text).not.toContain("late output after exit");
      expect(renderer.buffer.active.type).toBe("normal");
      expect(frames.find((frame) => frame.message.type === "lifecycle")?.message).toMatchObject({
        lifecycle: "exited",
      });
      expect((await Effect.runPromise(service.list({ kind: "all" }))).terminals).toEqual([]);
    } finally {
      renderer.dispose();
      await Effect.runPromise(service.dispose());
    }
  }, 5_000);

  test("uses parser and consumer pressure for pause and resumes after ACK", async () => {
    const service = await makeService();
    const native = makeHandle();
    const source = await Effect.runPromise(
      service.openOutputSource({
        context,
        workingDir: "/repo",
        label: "Output",
        command: "bun run dev",
        onForgotten: () => {},
      }),
    );
    let delivered = 0;
    try {
      await Effect.runPromise(source.activate(native.handle));
      await Effect.runPromise(
        service.attach({
          terminalId: source.terminalId,
          attachmentId: "consumer",
          lastConsumedSequence: 0,
          sink: (message) => {
            if (message.type === "output") delivered = message.sequenceEnd;
            return true;
          },
        }),
      );
      const chunk = new Uint8Array(64 * 1024).fill(120);
      for (let index = 0; index < 9; index += 1) source.write(chunk);
      await waitFor(native.isPaused);
      await Effect.runPromise(service.acknowledge(source.terminalId, "consumer", delivered));
      await waitFor(() => !native.isPaused());
      expect(native.operations).toContain("resume");
      for (const effect of [
        service.write(source.terminalId, encoder.encode("input")),
        service.preparePathInput({ terminalId: source.terminalId, paths: ["/image.png"] }),
        service.close({ terminalId: source.terminalId, confirmTerminate: true }),
      ]) {
        const result = await Effect.runPromise(Effect.result(effect));
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") expect(result.failure.code).toBe("invalid_input");
      }
    } finally {
      await Effect.runPromise(service.dispose());
    }
  });

  test("holds cleanup through pending source creation and applies the full context limit", async () => {
    const service = await makeService();
    const native = makeHandle();
    let forgotten = 0;
    const sources = [];
    for (let index = 0; index < TERMINAL_LIMITS.livePerTask; index += 1)
      sources.push(
        await Effect.runPromise(
          service.openOutputSource({
            context,
            workingDir: "/repo",
            label: "Output",
            command: "bun run dev",
            onForgotten: () => {
              forgotten += 1;
            },
          }),
        ),
      );
    const rejected = await Effect.runPromise(
      Effect.result(
        service.openOutputSource({
          context,
          workingDir: "/repo",
          label: "Too many",
          command: "bun run dev",
          onForgotten: () => {},
        }),
      ),
    );
    expect(rejected._tag).toBe("Failure");
    if (rejected._tag !== "Failure")
      throw new Error("Expected pending sources to reach the limit.");
    expect(rejected.failure.message).toContain(
      `${TERMINAL_LIMITS.livePerTask}/${TERMINAL_LIMITS.livePerTask}`,
    );
    expect(rejected.failure.message).toContain("Close a terminal or stop a dev server");
    let cleaned = false;
    const cleanup = Effect.runPromise(
      Effect.scoped(service.acquireTaskCleanup({ repoPath: "/repo", taskIds: ["task"] })),
    ).then(() => {
      cleaned = true;
    });
    await Bun.sleep(0);
    expect(cleaned).toBe(false);
    for (const source of sources) await Effect.runPromise(source.activate(native.handle));
    await cleanup;
    expect(forgotten).toBe(TERMINAL_LIMITS.livePerTask);
    expect(native.operations.filter((operation) => operation === "terminate")).toHaveLength(
      TERMINAL_LIMITS.livePerTask,
    );
    await Effect.runPromise(service.dispose());
  });
});

const makeDevServers = (
  terminals: Awaited<ReturnType<typeof makeService>>,
  processPort: DevServerProcessPort,
) =>
  createDevServerService({
    eventBus: { publish: () => {}, subscribe: () => () => {} },
    terminalSources: terminals,
    processPort,
    taskWorktreeService: { getTaskWorktree: () => Effect.succeed({ workingDirectory: "/repo" }) },
    workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
      getRepoConfigByRepoPath: () =>
        Effect.succeed(
          repoConfigSchema.parse({
            workspaceId: "workspace",
            workspaceName: "Workspace",
            repoPath: "/repo",
            devServers: [{ id: "dev", name: "Dev", command: "dev" }],
          }),
        ),
    }),
  });

describe("dev server terminal ownership", () => {
  test("closes a merged PR task when native stop succeeds before the exit callback", async () => {
    const terminals = await makeService();
    let startInput: DevServerProcessStartInput | undefined;
    let stopCalls = 0;
    let stopFails = true;
    const service = makeDevServers(terminals, {
      start: (input) => {
        startInput = input;
        return Effect.succeed({
          pid: 779,
          waitForReady: () => Effect.void,
          pauseOutput: () => Effect.void,
          resumeOutput: () => Effect.void,
          stop: () =>
            Effect.gen(function* () {
              stopCalls += 1;
              if (stopFails) {
                return yield* new HostOperationError({
                  operation: "stop",
                  message: "native stop failed",
                });
              }
            }),
        });
      },
    });
    let currentTask = task({
      id: "task",
      status: "human_review",
      pullRequest: {
        providerId: "github",
        number: 42,
        state: "open",
        url: "https://github.com/openai/openducktor/pull/42",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      },
    });
    const calls: unknown[] = [];
    const gitPort = createDirectMergeGitPort({ calls });
    const systemCommands = createPullRequestSyncSystemCommands({
      calls,
      payload: githubPullResponsePayload({
        number: 42,
        state: "closed",
        mergedAt: "2026-05-10T11:00:00.000Z",
      }),
    });
    const tasks = createTaskService({
      devServerService: service,
      terminalService: terminals,
      gitPort,
      gitProviderResolver: Effect.runSync(
        createGitProviderResolver([
          new GithubProviderAdapter({
            gitPort,
            systemCommands,
            toolDiscovery: createToolDiscoveryAdapter({ systemCommands }),
          }),
        ]),
      ),
      settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
      taskWorktreeService: { getTaskWorktree: () => Effect.succeed(null) },
      workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
        getRepoConfigByRepoPath: () =>
          Effect.succeed(
            repoConfigSchema.parse({
              workspaceId: "workspace",
              workspaceName: "Workspace",
              repoPath: "/repo",
              git: {
                provider: {
                  id: "github",
                  enabled: true,
                  autoDetected: false,
                  repository: { host: "github.com", owner: "openai", name: "openducktor" },
                },
              },
            }),
          ),
      }),
      taskStore: {
        listPullRequestSyncCandidates: () =>
          Effect.succeed(
            currentTask.pullRequest
              ? [
                  {
                    id: currentTask.id,
                    status: currentTask.status,
                    pullRequest: currentTask.pullRequest,
                  },
                ]
              : [],
          ),
        listTasks: () => Effect.succeed([currentTask]),
        setPullRequest: ({ pullRequest }) =>
          Effect.sync(() => {
            currentTask = { ...currentTask, pullRequest: pullRequest ?? undefined };
            return true;
          }),
        getTaskMetadata: () =>
          Effect.succeed({ spec: { markdown: "" }, plan: { markdown: "" }, agentSessions: [] }),
        transitionTask: ({ status }) =>
          Effect.sync(() => {
            currentTask = { ...currentTask, status };
            return currentTask;
          }),
      },
    });
    try {
      await Effect.runPromise(service.start(command));
      await expect(
        Effect.runPromise(tasks.repoPullRequestSync({ repoPath: "/repo" })),
      ).rejects.toThrow("Failed to terminate");
      expect(currentTask.status).toBe("human_review");
      expect((await Effect.runPromise(service.getState(command))).scripts[0]).toMatchObject({
        status: "failed",
        pid: 779,
        lastError: "native stop failed",
        terminalId: expect.any(String),
      });
      stopFails = false;
      expect(await Effect.runPromise(tasks.repoPullRequestSync({ repoPath: "/repo" }))).toEqual({
        ok: true,
      });
      expect(currentTask.status).toBe("closed");
      expect(currentTask.pullRequest?.state).toBe("merged");
      const stopped = await Effect.runPromise(service.getState(command));
      expect(stopped.scripts[0]).toMatchObject({ status: "stopped", pid: null, terminalId: null });
      expect(stopCalls).toBe(2);
      expect(
        (await Effect.runPromise(service.inspectWorkspaceActivity({ repoPath: "/repo" })))
          .activeOwners,
      ).toEqual([]);
      startInput?.onExit({ pid: 779, exitCode: 0, signal: null, error: null });
      expect((await Effect.runPromise(service.getState(command))).scripts[0]).toMatchObject({
        status: "stopped",
        pid: null,
        terminalId: null,
      });
    } finally {
      startInput?.onExit({ pid: 779, exitCode: 0, signal: null, error: null });
      await Effect.runPromise(terminals.dispose());
    }
  });

  test("keeps a failed native stop owned after startup overflow and supports Stop", async () => {
    const terminals = await makeService();
    let stopFails = true;
    const service = makeDevServers(terminals, {
      start: (input) => {
        input.onOutput({ data: "x".repeat(TERMINAL_LIMITS.replayBytes + 1) });
        return Effect.succeed({
          pid: 777,
          waitForReady: () => Effect.void,
          pauseOutput: () => Effect.void,
          resumeOutput: () => Effect.void,
          stop: () =>
            stopFails
              ? Effect.fail(
                  new HostOperationError({ operation: "stop", message: "native stop failed" }),
                )
              : Effect.sync(() =>
                  input.onExit({ pid: 777, exitCode: 0, signal: null, error: null }),
                ),
        });
      },
    });
    try {
      expect((await Effect.runPromise(Effect.result(service.start(command))))._tag).toBe("Failure");
      expect((await Effect.runPromise(service.getState(command))).scripts[0]).toMatchObject({
        status: "failed",
        pid: 777,
        lastError: "native stop failed",
      });
      expect(
        (await Effect.runPromise(service.inspectWorkspaceActivity({ repoPath: "/repo" })))
          .activeOwners,
      ).toEqual([owner]);
      stopFails = false;
      expect((await Effect.runPromise(service.stop(command))).scripts[0]).toMatchObject({
        status: "stopped",
        pid: null,
      });
    } finally {
      stopFails = false;
      await Effect.runPromise(service.stop(command));
      await Effect.runPromise(terminals.dispose());
    }
  });

  test("cleans interrupted readiness and clears forgotten terminal metadata", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const terminals = await makeService(() => now);
    let startInput: DevServerProcessStartInput | null = null;
    let stopped = false;
    const service = makeDevServers(terminals, {
      start: (input) => {
        startInput = input;
        return Effect.succeed({
          pid: 778,
          waitForReady: () => Effect.never,
          pauseOutput: () => Effect.void,
          resumeOutput: () => Effect.void,
          stop: () =>
            Effect.sync(() => {
              stopped = true;
              input.onOutput({ data: "shutdown\n" });
              input.onExit({ pid: 778, exitCode: 0, signal: null, error: null });
            }),
        });
      },
    });
    const fiber = Effect.runFork(service.start(command));
    try {
      await waitFor(() => startInput !== null);
      await Effect.runPromise(Fiber.interrupt(fiber));
      expect(stopped).toBe(true);
      const state = await Effect.runPromise(service.getState(command));
      expect(state.scripts[0]).toMatchObject({
        status: "stopped",
        pid: null,
        terminalId: expect.any(String),
      });
      now = new Date(now.getTime() + TERMINAL_LIMITS.exitedRetentionMs + 1);
      await Effect.runPromise(terminals.list({ kind: "all" }));
      const forgotten = await Effect.runPromise(service.getState(command));
      expect(forgotten.scripts[0]?.terminalId).toBeNull();
      expect(forgotten.revision).toBeGreaterThan(state.revision);
    } finally {
      await Effect.runPromise(Fiber.interrupt(fiber));
      await Effect.runPromise(terminals.dispose());
    }
  });
});
