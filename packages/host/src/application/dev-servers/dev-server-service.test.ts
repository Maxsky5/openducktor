import type { RepoConfig, TaskWorktreeSummary } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";
import type { HostEventBusPort } from "../../events/host-event-bus";
import type {
  DevServerProcessHandle,
  DevServerProcessPort,
  DevServerProcessStartInput,
} from "../../ports/dev-server-process-port";
import { DevServerProcessStartExitError } from "../../ports/dev-server-process-port";
import type { TaskWorktreeService } from "../tasks/worktrees/task-worktree-service";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-service";
import { createDevServerService as createEffectDevServerService } from "./dev-server-service";

const createDevServerService = (input: Parameters<typeof createEffectDevServerService>[0]) =>
  createEffectDevServerService(input);
type TestDevServerService = ReturnType<typeof createDevServerService>;
const repoConfig = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/canonical/repo",
  defaultRuntimeKind: "opencode",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
  hooks: { preStart: [], postComplete: [] },
  devServers: [
    {
      id: "web",
      name: "Web",
      command: "bun run dev",
    },
  ],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  ...overrides,
});
const createWorkspaceSettingsService = (config: RepoConfig): WorkspaceSettingsService =>
  ({
    getRepoConfigByRepoPath(repoPath: unknown) {
      return Effect.try({
        try: () => {
          if (repoPath !== "/repo") {
            throw new Error(`Workspace is not configured for repository: ${String(repoPath)}`);
          }
          return config;
        },
        catch: (cause) =>
          toHostOperationError(cause, "test.workspaceSettings.getRepoConfigByRepoPath"),
      });
    },
  }) as unknown as WorkspaceSettingsService;
const createWorkspaceSettingsServiceByRepoPath = (
  configs: Record<string, RepoConfig>,
): WorkspaceSettingsService =>
  ({
    getRepoConfigByRepoPath(repoPath: unknown) {
      return Effect.try({
        try: () => {
          const config = configs[String(repoPath)];
          if (!config) {
            throw new Error(`Workspace is not configured for repository: ${String(repoPath)}`);
          }
          return config;
        },
        catch: (cause) =>
          toHostOperationError(cause, "test.workspaceSettings.getRepoConfigByRepoPath"),
      });
    },
  }) as unknown as WorkspaceSettingsService;
const createTaskWorktreeService = (worktree: TaskWorktreeSummary | null): TaskWorktreeService => ({
  getTaskWorktree() {
    return Effect.succeed(worktree);
  },
});
const createEventBus = () => {
  const events: unknown[] = [];
  const eventBus: HostEventBusPort = {
    publish(channel, payload) {
      events.push({ channel, payload });
    },
    subscribe() {
      return () => {};
    },
  };
  return { eventBus, events };
};
const createProcessPort = () => {
  const starts: DevServerProcessStartInput[] = [];
  const stoppedPids: number[] = [];
  const handles = new Map<number, DevServerProcessHandle>();
  let nextPid = 400;
  const processPort: DevServerProcessPort = {
    start(input) {
      starts.push(input);
      const pid = nextPid;
      nextPid += 1;
      input.onOutput({ data: "ready\n" });
      const handle: DevServerProcessHandle = {
        pid,
        stop() {
          return Effect.try({
            try: () => {
              stoppedPids.push(pid);
              input.onExit({ pid, exitCode: 0, signal: null, error: null });
            },
            catch: (cause) => toHostOperationError(cause, "test.devServerProcess.stop"),
          });
        },
      };
      handles.set(pid, handle);
      return Effect.succeed(handle);
    },
  };
  return { handles, processPort, starts, stoppedPids };
};
const expectStartFailure = async (service: TestDevServerService): Promise<HostOperationError> => {
  const startResult = await Effect.runPromise(
    Effect.either(service.start({ repoPath: "/repo", taskId: "task-1" })),
  );
  if (startResult._tag === "Right") {
    throw new Error("Expected dev server start to fail.");
  }
  if (!(startResult.left instanceof HostOperationError)) {
    throw new Error("Expected dev server start to fail with HostOperationError.");
  }
  return startResult.left;
};
describe("createDevServerService", () => {
  test("returns stopped state for configured dev server scripts", async () => {
    const service = createDevServerService({
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });
    await expect(
      Effect.runPromise(
        service.getState({
          repoPath: "/repo",
          taskId: "task-1",
        }),
      ),
    ).resolves.toMatchObject({
      repoPath: "/canonical/repo",
      taskId: "task-1",
      worktreePath: null,
      scripts: [
        {
          scriptId: "web",
          name: "Web",
          command: "bun run dev",
          status: "stopped",
          pid: null,
          startedAt: null,
          exitCode: null,
          lastError: null,
          bufferedTerminalChunks: [],
        },
      ],
      updatedAt: expect.any(String),
    });
  });
  test("includes the deterministic task worktree when resolved", async () => {
    const service = createDevServerService({
      taskWorktreeService: createTaskWorktreeService({ workingDirectory: "/worktrees/task-1" }),
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });
    await expect(
      Effect.runPromise(
        service.getState({
          repoPath: "/repo",
          taskId: "task-1",
        }),
      ),
    ).resolves.toMatchObject({
      worktreePath: "/worktrees/task-1",
    });
  });
  test("starts configured scripts in the deterministic task worktree", async () => {
    const { eventBus, events } = createEventBus();
    const { processPort, starts } = createProcessPort();
    const service = createDevServerService({
      eventBus,
      processPort,
      taskWorktreeService: createTaskWorktreeService({ workingDirectory: "/worktrees/task-1" }),
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });
    await expect(
      Effect.runPromise(
        service.start({
          repoPath: "/repo",
          taskId: "task-1",
        }),
      ),
    ).resolves.toMatchObject({
      worktreePath: "/worktrees/task-1",
      scripts: [
        {
          scriptId: "web",
          status: "running",
          pid: 400,
          bufferedTerminalChunks: [
            {
              data: "Starting `bun run dev`\r\n",
              sequence: 0,
            },
            {
              data: "ready\r\n",
              sequence: 1,
            },
          ],
        },
      ],
    });
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      command: "bun run dev",
      cwd: "/worktrees/task-1",
      env: {
        CLICOLOR_FORCE: "1",
        COLORTERM: "truecolor",
        FORCE_COLOR: "1",
        TERM: "xterm-256color",
      },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: "openducktor://dev-server-event",
          payload: expect.objectContaining({ type: "snapshot" }),
        }),
        expect.objectContaining({
          channel: "openducktor://dev-server-event",
          payload: expect.objectContaining({ type: "terminal_chunk" }),
        }),
        expect.objectContaining({
          channel: "openducktor://dev-server-event",
          payload: expect.objectContaining({ type: "script_status_changed" }),
        }),
      ]),
    );
  });
  test("trims buffered terminal output to the chunk limit", async () => {
    const processPort: DevServerProcessPort = {
      start(input) {
        for (let index = 0; index < 2_005; index += 1) {
          input.onOutput({ data: `line-${index}\n` });
        }

        return Effect.succeed({
          pid: 410,
          stop: () => Effect.succeed(undefined),
        });
      },
    };
    const service = createDevServerService({
      processPort,
      taskWorktreeService: createTaskWorktreeService({ workingDirectory: "/worktrees/task-1" }),
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });

    const state = await Effect.runPromise(service.start({ repoPath: "/repo", taskId: "task-1" }));
    const chunks = state.scripts[0]?.bufferedTerminalChunks ?? [];

    expect(chunks).toHaveLength(2_000);
    expect(chunks[0]).toMatchObject({ sequence: 6, data: "line-5\r\n" });
    expect(chunks.at(-1)).toMatchObject({ sequence: 2005, data: "line-2004\r\n" });
  });
  test("trims buffered terminal output to the byte limit", async () => {
    const halfLimitChunk = "x".repeat(256 * 1024);
    const processPort: DevServerProcessPort = {
      start(input) {
        input.onOutput({ data: halfLimitChunk });
        input.onOutput({ data: halfLimitChunk });
        input.onOutput({ data: halfLimitChunk });

        return Effect.succeed({
          pid: 411,
          stop: () => Effect.succeed(undefined),
        });
      },
    };
    const service = createDevServerService({
      processPort,
      taskWorktreeService: createTaskWorktreeService({ workingDirectory: "/worktrees/task-1" }),
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });

    const state = await Effect.runPromise(service.start({ repoPath: "/repo", taskId: "task-1" }));
    const chunks = state.scripts[0]?.bufferedTerminalChunks ?? [];

    expect(chunks.map((chunk) => chunk.sequence)).toEqual([2, 3]);
    expect(chunks.reduce((total, chunk) => total + chunk.data.length, 0)).toBe(512 * 1024);
  });
  test("keeps terminal sequences increasing after an oversized chunk empties replay", async () => {
    const { eventBus, events } = createEventBus();
    const oversizedChunk = "x".repeat(600 * 1024);
    const processPort: DevServerProcessPort = {
      start(input) {
        input.onOutput({ data: oversizedChunk });
        input.onOutput({ data: "still live\n" });

        return Effect.succeed({
          pid: 413,
          stop: () => Effect.succeed(undefined),
        });
      },
    };
    const service = createDevServerService({
      eventBus,
      processPort,
      taskWorktreeService: createTaskWorktreeService({ workingDirectory: "/worktrees/task-1" }),
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });

    const state = await Effect.runPromise(service.start({ repoPath: "/repo", taskId: "task-1" }));
    const terminalChunks = events
      .map((event) => (event as { payload?: unknown }).payload)
      .filter(
        (payload): payload is { terminalChunk: { data: string; sequence: number }; type: string } =>
          typeof payload === "object" &&
          payload !== null &&
          "type" in payload &&
          payload.type === "terminal_chunk" &&
          "terminalChunk" in payload,
      )
      .map((payload) => payload.terminalChunk);

    expect(terminalChunks.map((chunk) => chunk.sequence)).toEqual([0, 1, 2]);
    expect(terminalChunks.map((chunk) => chunk.data)).toEqual([
      "Starting `bun run dev`\r\n",
      oversizedChunk,
      "still live\r\n",
    ]);
    expect(state.scripts[0]?.bufferedTerminalChunks.map((chunk) => chunk.data)).toEqual([
      "still live\r\n",
    ]);
  });
  test("rejects duplicate starts while a script is running", async () => {
    const { processPort } = createProcessPort();
    const service = createDevServerService({
      processPort,
      taskWorktreeService: createTaskWorktreeService({ workingDirectory: "/worktrees/task-1" }),
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });
    await Effect.runPromise(service.start({ repoPath: "/repo", taskId: "task-1" }));
    await expect(
      Effect.runPromise(service.start({ repoPath: "/repo", taskId: "task-1" })),
    ).rejects.toThrow(
      "Dev servers are already running for task task-1. Stop or restart them instead.",
    );
  });
  test("requires a builder worktree before starting scripts", async () => {
    const { processPort } = createProcessPort();
    const service = createDevServerService({
      processPort,
      taskWorktreeService: createTaskWorktreeService(null),
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });
    await expect(
      Effect.runPromise(service.start({ repoPath: "/repo", taskId: "task-1" })),
    ).rejects.toThrow(
      "Builder continuation cannot start until a builder worktree exists for task task-1. Start Builder first.",
    );
  });
  test("fails start when no dev server scripts are configured", async () => {
    const { processPort } = createProcessPort();
    const service = createDevServerService({
      processPort,
      taskWorktreeService: createTaskWorktreeService({ workingDirectory: "/worktrees/task-1" }),
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig({ devServers: [] })),
    });
    await expect(
      Effect.runPromise(service.start({ repoPath: "/repo", taskId: "task-1" })),
    ).rejects.toThrow(
      "No builder dev server scripts are configured for /canonical/repo. Add them in repository settings first.",
    );
  });
  test("stops started scripts and fails when any configured script fails to start", async () => {
    const starts: string[] = [];
    const stoppedPids: number[] = [];
    const processPort: DevServerProcessPort = {
      start(input) {
        starts.push(input.command);
        if (input.command === "exit 42") {
          return Effect.fail(new DevServerProcessStartExitError(42, null)) as unknown as ReturnType<
            DevServerProcessPort["start"]
          >;
        }
        return Effect.succeed({
          pid: 501,
          stop: () =>
            Effect.sync(() => {
              stoppedPids.push(501);
              input.onExit({ pid: 501, exitCode: 0, signal: null, error: null });
            }),
        });
      },
    };
    const service = createDevServerService({
      processPort,
      taskWorktreeService: createTaskWorktreeService({ workingDirectory: "/worktrees/task-1" }),
      workspaceSettingsService: createWorkspaceSettingsService(
        repoConfig({
          devServers: [
            { id: "web", name: "Web", command: "bun run dev" },
            { id: "api", name: "API", command: "exit 42" },
            { id: "worker", name: "Worker", command: "bun run worker" },
          ],
        }),
      ),
    });
    const startError = await expectStartFailure(service);
    expect(startError.message).toContain("Failed to start all configured dev server scripts.");
    expect(startError.details).toEqual({
      cleanupErrors: [],
      failedScripts: [
        {
          command: "exit 42",
          message: "Dev server exited with code 42.",
          name: "API",
          scriptId: "api",
        },
      ],
      repoPath: "/repo",
      stoppedScripts: [
        {
          command: "bun run dev",
          name: "Web",
          pid: 501,
          repoPath: "/canonical/repo",
          scriptId: "web",
          taskId: "task-1",
        },
      ],
      taskId: "task-1",
    });
    expect(starts).toEqual(["bun run dev", "exit 42"]);
    expect(stoppedPids).toEqual([501]);
    await expect(
      Effect.runPromise(service.getState({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toMatchObject({
      scripts: [
        { scriptId: "web", status: "stopped", pid: null },
        {
          scriptId: "api",
          status: "failed",
          pid: null,
          exitCode: 42,
          lastError: "Dev server exited with code 42.",
        },
        { scriptId: "worker", status: "stopped", pid: null },
      ],
    });
  });
  test("reports cleanup errors when a started script cannot be stopped after start failure", async () => {
    const processPort: DevServerProcessPort = {
      start(input) {
        if (input.command === "exit 42") {
          return Effect.fail(new DevServerProcessStartExitError(42, null)) as unknown as ReturnType<
            DevServerProcessPort["start"]
          >;
        }
        return Effect.succeed({
          pid: 501,
          stop: () =>
            Effect.fail(
              new HostOperationError({
                operation: "test.devServerProcess.stop",
                message: "stop failed",
              }),
            ),
        });
      },
    };
    const service = createDevServerService({
      processPort,
      taskWorktreeService: createTaskWorktreeService({ workingDirectory: "/worktrees/task-1" }),
      workspaceSettingsService: createWorkspaceSettingsService(
        repoConfig({
          devServers: [
            { id: "web", name: "Web", command: "bun run dev" },
            { id: "api", name: "API", command: "exit 42" },
          ],
        }),
      ),
    });
    const startError = await expectStartFailure(service);
    expect(startError.message).toContain("Failed cleaning up dev server web: stop failed");
    expect(startError.details).toEqual({
      cleanupErrors: ["Failed cleaning up dev server web: stop failed"],
      failedScripts: [
        {
          command: "exit 42",
          message: "Dev server exited with code 42.",
          name: "API",
          scriptId: "api",
        },
      ],
      repoPath: "/repo",
      stoppedScripts: [],
      taskId: "task-1",
    });
    await expect(
      Effect.runPromise(service.getState({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toMatchObject({
      scripts: [
        {
          scriptId: "web",
          status: "failed",
          pid: 501,
          lastError: "stop failed",
        },
        {
          scriptId: "api",
          status: "failed",
          pid: null,
          exitCode: 42,
          lastError: "Dev server exited with code 42.",
        },
      ],
    });
  });
  test("does not mark a script running when it exits before the handle is recorded", async () => {
    const processPort: DevServerProcessPort = {
      start(input) {
        input.onExit({ pid: 601, exitCode: 9, signal: null, error: null });
        return Effect.succeed({
          pid: 601,
          stop: () => Effect.succeed(undefined),
        });
      },
    };
    const service = createDevServerService({
      processPort,
      taskWorktreeService: createTaskWorktreeService({ workingDirectory: "/worktrees/task-1" }),
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });
    const startError = await expectStartFailure(service);
    expect(startError.details).toEqual({
      cleanupErrors: [],
      failedScripts: [
        {
          command: "bun run dev",
          message: "Dev server exited with code 9.",
          name: "Web",
          scriptId: "web",
        },
      ],
      repoPath: "/repo",
      stoppedScripts: [],
      taskId: "task-1",
    });
    await expect(
      Effect.runPromise(service.getState({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toMatchObject({
      scripts: [
        {
          scriptId: "web",
          status: "failed",
          pid: null,
          exitCode: 9,
          lastError: "Dev server exited with code 9.",
        },
      ],
    });
  });
  test("stops running scripts and returns stopped state", async () => {
    const { processPort, stoppedPids } = createProcessPort();
    const service = createDevServerService({
      processPort,
      taskWorktreeService: createTaskWorktreeService({ workingDirectory: "/worktrees/task-1" }),
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });
    await Effect.runPromise(service.start({ repoPath: "/repo", taskId: "task-1" }));
    await expect(
      Effect.runPromise(service.stop({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toMatchObject({
      scripts: [{ scriptId: "web", status: "stopped", pid: null }],
    });
    expect(stoppedPids).toEqual([400]);
  });
  test("preserves existing and shutdown terminal output when stopping", async () => {
    const stoppedPids: number[] = [];
    const processPort: DevServerProcessPort = {
      start(input) {
        input.onOutput({ data: "ready\n" });

        return Effect.succeed({
          pid: 412,
          stop: () =>
            Effect.sync(() => {
              stoppedPids.push(412);
              input.onOutput({ data: "closing dev server\n" });
              input.onExit({ pid: 412, exitCode: 0, signal: null, error: null });
            }),
        });
      },
    };
    const service = createDevServerService({
      processPort,
      taskWorktreeService: createTaskWorktreeService({ workingDirectory: "/worktrees/task-1" }),
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });

    await Effect.runPromise(service.start({ repoPath: "/repo", taskId: "task-1" }));
    const state = await Effect.runPromise(service.stop({ repoPath: "/repo", taskId: "task-1" }));

    expect(stoppedPids).toEqual([412]);
    expect(state.scripts[0]?.bufferedTerminalChunks.map((chunk) => chunk.data)).toEqual([
      "Starting `bun run dev`\r\n",
      "ready\r\n",
      "closing dev server\r\n",
    ]);
    expect(state.scripts[0]).toMatchObject({ status: "stopped", pid: null });
  });
  test("discards output from a stopped process after its replacement run starts", async () => {
    const starts: DevServerProcessStartInput[] = [];
    const processPort: DevServerProcessPort = {
      start(input) {
        starts.push(input);
        const pid = 700;
        return Effect.succeed({
          pid,
          stop: () =>
            Effect.sync(() => {
              input.onExit({ pid, exitCode: 0, signal: null, error: null });
            }),
        });
      },
    };
    const { eventBus, events } = createEventBus();
    const service = createDevServerService({
      eventBus,
      processPort,
      taskWorktreeService: createTaskWorktreeService({ workingDirectory: "/worktrees/task-1" }),
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });

    await Effect.runPromise(service.start({ repoPath: "/repo", taskId: "task-1" }));
    await Effect.runPromise(service.stop({ repoPath: "/repo", taskId: "task-1" }));
    await Effect.runPromise(service.start({ repoPath: "/repo", taskId: "task-1" }));
    starts[0]?.onOutput({ data: "LATE-OLD\n" });
    starts[0]?.onExit({ pid: 700, exitCode: 9, signal: null, error: null });

    const state = await Effect.runPromise(
      service.getState({ repoPath: "/repo", taskId: "task-1" }),
    );
    expect(
      state.scripts[0]?.bufferedTerminalChunks.some((chunk) => chunk.data.includes("LATE-OLD")),
    ).toBe(false);
    expect(
      events.some((event) =>
        JSON.stringify((event as { payload?: unknown }).payload).includes("LATE-OLD"),
      ),
    ).toBe(false);
    expect(state.scripts[0]).toMatchObject({ status: "running", pid: 700 });
  });
  test("uses a distinct run epoch after the host service is replaced", async () => {
    const createStartedService = async () => {
      const { processPort } = createProcessPort();
      const service = createDevServerService({
        processPort,
        taskWorktreeService: createTaskWorktreeService({ workingDirectory: "/worktrees/task-1" }),
        workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
      });
      return Effect.runPromise(service.start({ repoPath: "/repo", taskId: "task-1" }));
    };

    const firstState = await createStartedService();
    const replacementState = await createStartedService();
    const firstRun = firstState.scripts[0];
    const replacementRun = replacementState.scripts[0];

    expect(firstRun?.runIdentity?.runOrder.generation).toBe(1);
    expect(replacementRun?.runIdentity?.runOrder.generation).toBe(1);
    expect(replacementRun?.runIdentity?.runOrder.hostInstanceId).not.toBe(
      firstRun?.runIdentity?.runOrder.hostInstanceId,
    );
    expect(replacementRun?.runIdentity?.runId).not.toBe(firstRun?.runIdentity?.runId);
  });
  test("keeps runtime ownership isolated for delimiter-colliding repo and task strings", async () => {
    const { processPort, starts } = createProcessPort();
    const service = createDevServerService({
      processPort,
      taskWorktreeService: createTaskWorktreeService({ workingDirectory: "/worktrees/task" }),
      workspaceSettingsService: createWorkspaceSettingsServiceByRepoPath({
        "/repo": repoConfig({
          repoPath: "/repo",
          devServers: [{ id: "web", name: "Web", command: "right-command" }],
        }),
        "/repo::task-b": repoConfig({
          repoPath: "/repo::task-b",
          devServers: [{ id: "web", name: "Web", command: "left-command" }],
        }),
      }),
    });

    await expect(
      Effect.runPromise(service.start({ repoPath: "/repo::task-b", taskId: "task-c" })),
    ).resolves.toMatchObject({
      repoPath: "/repo::task-b",
      taskId: "task-c",
      scripts: [{ scriptId: "web", pid: 400, command: "left-command" }],
    });
    await expect(
      Effect.runPromise(service.start({ repoPath: "/repo", taskId: "task-b::task-c" })),
    ).resolves.toMatchObject({
      repoPath: "/repo",
      taskId: "task-b::task-c",
      scripts: [{ scriptId: "web", pid: 401, command: "right-command" }],
    });
    await expect(
      Effect.runPromise(service.getState({ repoPath: "/repo::task-b", taskId: "task-c" })),
    ).resolves.toMatchObject({
      repoPath: "/repo::task-b",
      taskId: "task-c",
      scripts: [{ scriptId: "web", pid: 400, command: "left-command" }],
    });
    await expect(
      Effect.runPromise(service.getState({ repoPath: "/repo", taskId: "task-b::task-c" })),
    ).resolves.toMatchObject({
      repoPath: "/repo",
      taskId: "task-b::task-c",
      scripts: [{ scriptId: "web", pid: 401, command: "right-command" }],
    });
    expect(starts.map((start) => start.command)).toEqual(["left-command", "right-command"]);
  });
  test("stops all running task dev server groups during host shutdown", async () => {
    const { processPort, stoppedPids } = createProcessPort();
    const service = createDevServerService({
      processPort,
      taskWorktreeService: createTaskWorktreeService({ workingDirectory: "/worktrees/task" }),
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });
    await Effect.runPromise(service.start({ repoPath: "/repo", taskId: "task-1" }));
    await Effect.runPromise(service.start({ repoPath: "/repo", taskId: "task-2" }));
    await expect(Effect.runPromise(service.stopAll())).resolves.toEqual({
      stoppedScripts: [
        {
          command: "bun run dev",
          name: "Web",
          pid: 400,
          repoPath: "/canonical/repo",
          scriptId: "web",
          taskId: "task-1",
        },
        {
          command: "bun run dev",
          name: "Web",
          pid: 401,
          repoPath: "/canonical/repo",
          scriptId: "web",
          taskId: "task-2",
        },
      ],
    });
    expect(stoppedPids).toEqual([400, 401]);
  });
  test("begins stopping every dev server process concurrently during host shutdown", async () => {
    let nextPid = 800;
    const stopCalls: number[] = [];
    let reportAllStopsStarted: (() => void) | undefined;
    const allStopsStarted = new Promise<void>((resolve) => {
      reportAllStopsStarted = resolve;
    });
    let releaseStops: (() => void) | undefined;
    const stopsReleased = new Promise<void>((resolve) => {
      releaseStops = resolve;
    });
    const processPort: DevServerProcessPort = {
      start(input) {
        const pid = nextPid;
        nextPid += 1;
        return Effect.succeed({
          pid,
          stop: () =>
            Effect.promise(async () => {
              stopCalls.push(pid);
              if (stopCalls.length === 4) {
                reportAllStopsStarted?.();
              }
              await stopsReleased;
              input.onExit({ pid, exitCode: 0, signal: null, error: null });
            }),
        });
      },
    };
    const service = createDevServerService({
      processPort,
      taskWorktreeService: createTaskWorktreeService({ workingDirectory: "/worktrees/task" }),
      workspaceSettingsService: createWorkspaceSettingsService(
        repoConfig({
          devServers: [
            { id: "web", name: "Web", command: "bun run dev" },
            { id: "api", name: "API", command: "bun run api" },
          ],
        }),
      ),
    });
    await Effect.runPromise(service.start({ repoPath: "/repo", taskId: "task-1" }));
    await Effect.runPromise(service.start({ repoPath: "/repo", taskId: "task-2" }));

    const stopping = Effect.runPromise(service.stopAll());
    let assertionFailure: unknown;
    try {
      const startedConcurrently = await Promise.race([
        allStopsStarted.then(() => true),
        Bun.sleep(500).then(() => false),
      ]);
      expect(startedConcurrently).toBe(true);
      expect(stopCalls).toHaveLength(4);
    } catch (error) {
      assertionFailure = error;
    } finally {
      releaseStops?.();
      await stopping;
    }
    if (assertionFailure) {
      throw assertionFailure;
    }
  });
});
