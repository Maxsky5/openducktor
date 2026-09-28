import {
  devServerOwnerSchema,
  type HostEventEnvelope,
  type RepoConfig,
  type TaskWorktreeSummary,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
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
import { createWorkspaceSettingsServiceTestDouble } from "../../test-support/service-test-doubles";
import { createWorkspaceSessionOperationGate } from "../workspaces/workspace-session-operation-gate";

const createDevServerService = (input: Parameters<typeof createEffectDevServerService>[0]) =>
  createEffectDevServerService(input);
type TestDevServerService = ReturnType<typeof createDevServerService>;
const repoConfig = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/canonical/repo",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
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
  agentStudioState: { openTaskIds: [] },
  ...overrides,
});
const createWorkspaceSettingsService = (config: RepoConfig): WorkspaceSettingsService =>
  createWorkspaceSettingsServiceTestDouble({
    getRepoConfigByRepoPath(repoPath: string) {
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
  });
const createWorkspaceSettingsServiceByRepoPath = (
  configs: Record<string, RepoConfig>,
): WorkspaceSettingsService =>
  createWorkspaceSettingsServiceTestDouble({
    getRepoConfigByRepoPath(repoPath: string) {
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
  });
const createTaskWorktreeService = (worktree: TaskWorktreeSummary | null): TaskWorktreeService => ({
  getTaskWorktree() {
    return Effect.succeed(worktree);
  },
});
const workspaceSession = (
  id: string,
  executionTarget: WorkspaceSession["executionTarget"],
  archivedAt: number | null = null,
): WorkspaceSession => ({
  id,
  runtimeKind: "codex",
  externalSessionId: null,
  executionTarget,
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt,
});
const createSessionServiceInput = (
  sessions: Map<string, WorkspaceSession>,
  config: RepoConfig,
  isValidDirectory: (path: string) => boolean = () => true,
) => ({
  store: {
    get: (ref: { sessionId: string }) => {
      const session = sessions.get(ref.sessionId);
      return session
        ? Effect.succeed(session)
        : Effect.fail(
            new HostValidationError({
              field: "sessionId",
              message: `Workspace Session ${ref.sessionId} was not found. Reload the Workspace.`,
            }),
          );
    },
  },
  settings: { getRepoConfig: () => Effect.succeed(config) },
  git: {
    canonicalizePath: (path: string) => Effect.succeed(path),
    isGitRepository: (path: string) => Effect.succeed(isValidDirectory(path)),
    shareGitCommonDirectory: () => Effect.succeed(true),
    isRegisteredWorktree: () => Effect.succeed(true),
  },
  operationGate: createWorkspaceSessionOperationGate(),
});
const createEventBus = () => {
  const events: HostEventEnvelope[] = [];
  const eventBus: HostEventBusPort = {
    publish(envelope) {
      events.push(envelope);
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
const createServiceWithMutableConfig = () => {
  const { processPort, starts } = createProcessPort();
  const config = repoConfig();
  const service = createDevServerService({
    processPort,
    taskWorktreeService: createTaskWorktreeService({ workingDirectory: "/worktrees/task-1" }),
    workspaceSettingsService: createWorkspaceSettingsService(config),
  });
  return { config, service, starts };
};
const devServerStartFailureSchema = z.object({
  message: z.string(),
  details: z.object({
    cleanupErrors: z.array(z.string()),
    failedScripts: z.array(
      z.object({
        command: z.string(),
        message: z.string(),
        name: z.string(),
        scriptId: z.string(),
      }),
    ),
    repoPath: z.string(),
    stoppedScripts: z.array(
      z.object({
        command: z.string(),
        name: z.string(),
        pid: z.number(),
        repoPath: z.string(),
        scriptId: z.string(),
        owner: devServerOwnerSchema,
      }),
    ),
    owner: devServerOwnerSchema,
  }),
});

const expectStartFailure = async (
  service: TestDevServerService,
): Promise<z.output<typeof devServerStartFailureSchema>> => {
  const startResult = await Effect.runPromise(
    Effect.either(service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } })),
  );
  if (startResult._tag === "Right") {
    throw new Error("Expected dev server start to fail.");
  }
  if (!(startResult.left instanceof HostOperationError)) {
    throw new Error("Expected dev server start to fail with HostOperationError.");
  }
  return devServerStartFailureSchema.parse(startResult.left);
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
          owner: { kind: "task", taskId: "task-1" },
        }),
      ),
    ).resolves.toMatchObject({
      repoPath: "/canonical/repo",
      owner: { kind: "task", taskId: "task-1" },
      workingDirectory: null,
      scripts: [
        {
          scriptId: "web",
          name: "Web",
          command: "bun run dev",
          startedCommand: null,
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
          owner: { kind: "task", taskId: "task-1" },
        }),
      ),
    ).resolves.toMatchObject({
      workingDirectory: "/worktrees/task-1",
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
          owner: { kind: "task", taskId: "task-1" },
        }),
      ),
    ).resolves.toMatchObject({
      workingDirectory: "/worktrees/task-1",
      scripts: [
        {
          scriptId: "web",
          status: "running",
          pid: 400,
          startedCommand: "bun run dev",
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

    const state = await Effect.runPromise(
      service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
    );
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

    const state = await Effect.runPromise(
      service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
    );
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

    const state = await Effect.runPromise(
      service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
    );
    const terminalChunkPayloadSchema = z.object({
      type: z.literal("terminal_chunk"),
      terminalChunk: z.object({ data: z.string(), sequence: z.number() }),
    });
    const terminalChunks = events
      .map((event) => terminalChunkPayloadSchema.safeParse(event.payload))
      .filter((payload) => payload.success)
      .map((payload) => payload.data.terminalChunk);

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
    await Effect.runPromise(
      service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
    );
    await expect(
      Effect.runPromise(
        service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
      ),
    ).rejects.toThrow(
      "Dev servers are already running for task task-1. Stop or restart them instead.",
    );
  });
  test("keeps the started command when repository settings change during the run", async () => {
    const { config, service, starts } = createServiceWithMutableConfig();

    await Effect.runPromise(
      service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
    );
    config.devServers = [{ id: "web", name: "Web", command: "bun run dev:next" }];

    await expect(
      Effect.runPromise(
        service.getState({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
      ),
    ).resolves.toMatchObject({
      scripts: [
        {
          scriptId: "web",
          command: "bun run dev:next",
          startedCommand: "bun run dev",
          status: "running",
        },
      ],
    });

    await Effect.runPromise(
      service.restart({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
    );

    expect(starts.map((start) => start.command)).toEqual(["bun run dev", "bun run dev:next"]);
    await expect(
      Effect.runPromise(
        service.getState({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
      ),
    ).resolves.toMatchObject({
      scripts: [
        {
          scriptId: "web",
          command: "bun run dev:next",
          startedCommand: "bun run dev:next",
          status: "running",
        },
      ],
    });
  });
  test("keeps the started command after a failure when repository settings change", async () => {
    const { config, service, starts } = createServiceWithMutableConfig();

    await Effect.runPromise(
      service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
    );
    config.devServers = [{ id: "web", name: "Web", command: "bun run dev:next" }];
    starts[0]?.onExit({ pid: 400, exitCode: 7, signal: null, error: null });

    await expect(
      Effect.runPromise(
        service.getState({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
      ),
    ).resolves.toMatchObject({
      scripts: [
        {
          scriptId: "web",
          command: "bun run dev:next",
          startedCommand: "bun run dev",
          status: "failed",
          exitCode: 7,
        },
      ],
    });
  });
  test("reports the started command when stopping scripts after repository settings change", async () => {
    const { config, service } = createServiceWithMutableConfig();

    await Effect.runPromise(
      service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
    );
    config.devServers = [{ id: "web", name: "Web", command: "bun run dev:next" }];
    await Effect.runPromise(
      service.getState({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
    );

    await expect(Effect.runPromise(service.stopAll())).resolves.toEqual({
      stoppedScripts: [
        {
          command: "bun run dev",
          name: "Web",
          pid: 400,
          repoPath: "/canonical/repo",
          scriptId: "web",
          owner: { kind: "task", taskId: "task-1" },
        },
      ],
    });
  });
  test("requires a task worktree before starting scripts", async () => {
    const { processPort } = createProcessPort();
    const service = createDevServerService({
      processPort,
      taskWorktreeService: createTaskWorktreeService(null),
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });
    await expect(
      Effect.runPromise(
        service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
      ),
    ).rejects.toThrow(
      "Builder continuation cannot start until a task worktree exists for task task-1. Start Builder first.",
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
      Effect.runPromise(
        service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
      ),
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
          return Effect.fail(new DevServerProcessStartExitError(42, null));
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
          owner: { kind: "task", taskId: "task-1" },
        },
      ],
      owner: { kind: "task", taskId: "task-1" },
    });
    expect(starts).toEqual(["bun run dev", "exit 42"]);
    expect(stoppedPids).toEqual([501]);
    await expect(
      Effect.runPromise(
        service.getState({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
      ),
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
          return Effect.fail(new DevServerProcessStartExitError(42, null));
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
      owner: { kind: "task", taskId: "task-1" },
    });
    await expect(
      Effect.runPromise(
        service.getState({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
      ),
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
      owner: { kind: "task", taskId: "task-1" },
    });
    await expect(
      Effect.runPromise(
        service.getState({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
      ),
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
    await Effect.runPromise(
      service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
    );
    await expect(
      Effect.runPromise(
        service.stop({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
      ),
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

    await Effect.runPromise(
      service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
    );
    const state = await Effect.runPromise(
      service.stop({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
    );

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

    await Effect.runPromise(
      service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
    );
    await Effect.runPromise(
      service.stop({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
    );
    await Effect.runPromise(
      service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
    );
    starts[0]?.onOutput({ data: "LATE-OLD\n" });
    starts[0]?.onExit({ pid: 700, exitCode: 9, signal: null, error: null });

    const state = await Effect.runPromise(
      service.getState({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
    );
    expect(
      state.scripts[0]?.bufferedTerminalChunks.some((chunk) => chunk.data.includes("LATE-OLD")),
    ).toBe(false);
    expect(events.some((event) => JSON.stringify(event.payload).includes("LATE-OLD"))).toBe(false);
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
      return Effect.runPromise(
        service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
      );
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
      Effect.runPromise(
        service.start({ repoPath: "/repo::task-b", owner: { kind: "task", taskId: "task-c" } }),
      ),
    ).resolves.toMatchObject({
      repoPath: "/repo::task-b",
      owner: { kind: "task", taskId: "task-c" },
      scripts: [{ scriptId: "web", pid: 400, command: "left-command" }],
    });
    await expect(
      Effect.runPromise(
        service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-b::task-c" } }),
      ),
    ).resolves.toMatchObject({
      repoPath: "/repo",
      owner: { kind: "task", taskId: "task-b::task-c" },
      scripts: [{ scriptId: "web", pid: 401, command: "right-command" }],
    });
    await expect(
      Effect.runPromise(
        service.getState({ repoPath: "/repo::task-b", owner: { kind: "task", taskId: "task-c" } }),
      ),
    ).resolves.toMatchObject({
      repoPath: "/repo::task-b",
      owner: { kind: "task", taskId: "task-c" },
      scripts: [{ scriptId: "web", pid: 400, command: "left-command" }],
    });
    await expect(
      Effect.runPromise(
        service.getState({ repoPath: "/repo", owner: { kind: "task", taskId: "task-b::task-c" } }),
      ),
    ).resolves.toMatchObject({
      repoPath: "/repo",
      owner: { kind: "task", taskId: "task-b::task-c" },
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
    await Effect.runPromise(
      service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
    );
    await Effect.runPromise(
      service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-2" } }),
    );
    await expect(Effect.runPromise(service.stopAll())).resolves.toEqual({
      stoppedScripts: [
        {
          command: "bun run dev",
          name: "Web",
          pid: 400,
          repoPath: "/canonical/repo",
          scriptId: "web",
          owner: { kind: "task", taskId: "task-1" },
        },
        {
          command: "bun run dev",
          name: "Web",
          pid: 401,
          repoPath: "/canonical/repo",
          scriptId: "web",
          owner: { kind: "task", taskId: "task-2" },
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
    await Effect.runPromise(
      service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-1" } }),
    );
    await Effect.runPromise(
      service.start({ repoPath: "/repo", owner: { kind: "task", taskId: "task-2" } }),
    );

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
  test("isolates Workspace Sessions that share a root and runs worktree scripts in the saved directory", async () => {
    const config = repoConfig({ workspaceId: "ws-1", repoPath: "/repo" });
    const sessions = new Map([
      [
        "root-1",
        workspaceSession("root-1", { kind: "local_repo_root", workingDirectory: "/repo" }),
      ],
      [
        "root-2",
        workspaceSession("root-2", { kind: "local_repo_root", workingDirectory: "/repo" }),
      ],
      [
        "worktree",
        workspaceSession("worktree", {
          kind: "local_worktree",
          workingDirectory: "/worktrees/worktree",
          branchName: "session",
          worktreeState: "present",
        }),
      ],
    ]);
    const { processPort, starts, stoppedPids } = createProcessPort();
    const service = createDevServerService({
      processPort,
      workspaceSettingsService: createWorkspaceSettingsService(config),
      workspaceSessions: createSessionServiceInput(sessions, config),
    });
    const owner = (sessionId: string) => ({
      kind: "workspace_session" as const,
      workspaceId: "ws-1",
      sessionId,
    });
    const first = await Effect.runPromise(
      service.start({ repoPath: "/repo", owner: owner("root-1") }),
    );
    const second = await Effect.runPromise(
      service.start({ repoPath: "/repo", owner: owner("root-2") }),
    );
    const third = await Effect.runPromise(
      service.start({ repoPath: "/repo", owner: owner("worktree") }),
    );
    expect(starts.map((start) => start.cwd)).toEqual(["/repo", "/repo", "/worktrees/worktree"]);
    expect(first.workingDirectory).toBe("/repo");
    expect(third.workingDirectory).toBe("/worktrees/worktree");
    expect(first.scripts[0]?.runIdentity?.runId).not.toBe(second.scripts[0]?.runIdentity?.runId);
    await Effect.runPromise(
      service.stop({
        repoPath: "/repo",
        owner: { sessionId: "root-1", workspaceId: "ws-1", kind: "workspace_session" },
      }),
    );
    expect(stoppedPids).toHaveLength(1);
    expect(
      (await Effect.runPromise(service.getState({ repoPath: "/repo", owner: owner("root-2") })))
        .scripts[0]?.status,
    ).toBe("running");
    expect(
      (await Effect.runPromise(service.inspectWorkspaceActivity({ repoPath: "/repo" })))
        .activeOwners,
    ).toEqual([owner("root-2"), owner("worktree")]);
    await Effect.runPromise(service.stopAll());
  });

  test("keeps a removed script controllable until its Workspace Session stops it", async () => {
    const config = repoConfig({ workspaceId: "ws-1", repoPath: "/repo" });
    const owner = { kind: "workspace_session" as const, workspaceId: "ws-1", sessionId: "root" };
    const sessions = new Map([
      ["root", workspaceSession("root", { kind: "local_repo_root", workingDirectory: "/repo" })],
    ]);
    const { processPort, stoppedPids } = createProcessPort();
    const service = createDevServerService({
      processPort,
      workspaceSettingsService: createWorkspaceSettingsService(config),
      workspaceSessions: createSessionServiceInput(sessions, config),
    });
    await Effect.runPromise(service.start({ repoPath: "/repo", owner }));
    config.devServers = [];

    const running = await Effect.runPromise(service.getState({ repoPath: "/repo", owner }));
    expect(running.scripts[0]?.status).toBe("running");
    expect(running.scripts[0]?.name).toBe("Web");
    expect(
      (await Effect.runPromise(service.inspectWorkspaceActivity({ repoPath: "/repo" })))
        .activeOwners,
    ).toEqual([owner]);

    const stopped = await Effect.runPromise(service.stop({ repoPath: "/repo", owner }));
    expect(stoppedPids).toHaveLength(1);
    expect(stopped.scripts).toEqual([]);
    expect(
      (await Effect.runPromise(service.inspectWorkspaceActivity({ repoPath: "/repo" })))
        .activeOwners,
    ).toEqual([]);
  });

  test("rejects missing, archived, removed, and invalid Workspace Session targets before spawn", async () => {
    const config = repoConfig({ workspaceId: "ws-1", repoPath: "/repo" });
    const sessions = new Map([
      [
        "archived",
        workspaceSession("archived", { kind: "local_repo_root", workingDirectory: "/repo" }, 2),
      ],
      [
        "removed",
        workspaceSession("removed", {
          kind: "local_worktree",
          workingDirectory: "/worktrees/removed",
          branchName: "removed",
          worktreeState: "removed",
        }),
      ],
      [
        "invalid",
        workspaceSession("invalid", { kind: "local_repo_root", workingDirectory: "/missing" }),
      ],
    ]);
    const { processPort, starts } = createProcessPort();
    const service = createDevServerService({
      processPort,
      workspaceSettingsService: createWorkspaceSettingsService(config),
      workspaceSessions: createSessionServiceInput(sessions, config, (path) => path !== "/missing"),
    });
    for (const [sessionId, reason] of [
      ["missing", "not found"],
      ["archived", "archived"],
      ["removed", "removed"],
      ["invalid", "/missing"],
    ] as const) {
      await expect(
        Effect.runPromise(
          service.start({
            repoPath: "/repo",
            owner: { kind: "workspace_session", workspaceId: "ws-1", sessionId },
          }),
        ),
      ).rejects.toThrow(reason);
    }
    await expect(
      Effect.runPromise(
        service.start({
          repoPath: "/other",
          owner: { kind: "workspace_session", workspaceId: "ws-1", sessionId: "invalid" },
        }),
      ),
    ).rejects.toThrow("belongs to /repo");
    expect(starts).toHaveLength(0);
  });

  test("reports missing repository scripts for a Workspace Session before spawn", async () => {
    const config = repoConfig({ workspaceId: "ws-1", repoPath: "/repo", devServers: [] });
    const sessions = new Map([
      ["root", workspaceSession("root", { kind: "local_repo_root", workingDirectory: "/repo" })],
    ]);
    const { processPort, starts } = createProcessPort();
    const service = createDevServerService({
      processPort,
      workspaceSettingsService: createWorkspaceSettingsService(config),
      workspaceSessions: createSessionServiceInput(sessions, config),
    });
    await expect(
      Effect.runPromise(
        service.start({
          repoPath: "/repo",
          owner: { kind: "workspace_session", workspaceId: "ws-1", sessionId: "root" },
        }),
      ),
    ).rejects.toThrow("No dev server scripts are configured");
    expect(starts).toHaveLength(0);
  });

  test("retains a failed Workspace Session stop as a workspace blocker", async () => {
    const config = repoConfig({ workspaceId: "ws-1", repoPath: "/repo" });
    const sessions = new Map([
      ["root", workspaceSession("root", { kind: "local_repo_root", workingDirectory: "/repo" })],
    ]);
    const owner = { kind: "workspace_session" as const, workspaceId: "ws-1", sessionId: "root" };
    const processPort: DevServerProcessPort = {
      start: () =>
        Effect.succeed({
          pid: 501,
          stop: () =>
            Effect.fail(
              new HostOperationError({ operation: "test.stop", message: "permission denied" }),
            ),
        }),
    };
    const service = createDevServerService({
      processPort,
      workspaceSettingsService: createWorkspaceSettingsService(config),
      workspaceSessions: createSessionServiceInput(sessions, config),
    });
    await Effect.runPromise(service.start({ repoPath: "/repo", owner }));
    await expect(Effect.runPromise(service.stop({ repoPath: "/repo", owner }))).rejects.toThrow(
      "permission denied",
    );
    expect(
      (await Effect.runPromise(service.getState({ repoPath: "/repo", owner }))).scripts[0],
    ).toMatchObject({ status: "failed", lastError: "permission denied" });
    expect(
      (await Effect.runPromise(service.inspectWorkspaceActivity({ repoPath: "/repo" })))
        .activeOwners,
    ).toEqual([owner]);
  });
});
