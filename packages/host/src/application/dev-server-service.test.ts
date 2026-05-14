import type { RepoConfig } from "@openducktor/contracts";
import type { HostEventBusPort } from "../events/host-event-bus";
import type {
  DevServerProcessHandle,
  DevServerProcessPort,
  DevServerProcessStartInput,
} from "../ports/dev-server-process-port";
import { DevServerProcessStartExitError } from "../ports/dev-server-process-port";
import { createDevServerService } from "./dev-server-service";
import type { WorkspaceSettingsService } from "./workspace-settings-service";

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
    async getRepoConfigByRepoPath(repoPath: unknown) {
      if (repoPath !== "/repo") {
        throw new Error(`Workspace is not configured for repository: ${String(repoPath)}`);
      }

      return config;
    },
  }) as WorkspaceSettingsService;

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
    async start(input) {
      starts.push(input);
      const pid = nextPid;
      nextPid += 1;
      input.onOutput({ data: "ready\n" });
      const handle: DevServerProcessHandle = {
        pid,
        async stop() {
          stoppedPids.push(pid);
          input.onExit({ pid, exitCode: 0, signal: null, error: null });
        },
      };
      handles.set(pid, handle);
      return handle;
    },
  };

  return { handles, processPort, starts, stoppedPids };
};

describe("createDevServerService", () => {
  test("returns stopped state for configured dev server scripts", async () => {
    const service = createDevServerService({
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });

    await expect(
      service.getState({
        repoPath: "/repo",
        taskId: "task-1",
      }),
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
      taskWorktreeService: {
        async getTaskWorktree() {
          return { workingDirectory: "/worktrees/task-1" };
        },
      },
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });

    await expect(
      service.getState({
        repoPath: "/repo",
        taskId: "task-1",
      }),
    ).resolves.toMatchObject({
      worktreePath: "/worktrees/task-1",
    });
  });

  test("rejects malformed inputs", async () => {
    const service = createDevServerService({
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });

    await expect(service.getState({ repoPath: "/repo" })).rejects.toThrow("taskId is required.");
    await expect(service.getState(null)).rejects.toThrow(
      "dev_server_get_state input must be an object.",
    );
  });

  test("starts configured scripts in the deterministic task worktree", async () => {
    const { eventBus, events } = createEventBus();
    const { processPort, starts } = createProcessPort();
    const service = createDevServerService({
      eventBus,
      processPort,
      taskWorktreeService: {
        async getTaskWorktree() {
          return { workingDirectory: "/worktrees/task-1" };
        },
      },
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });

    await expect(
      service.start({
        repoPath: "/repo",
        taskId: "task-1",
      }),
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
              data: "ready\n",
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
        COLORTERM: "truecolor",
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

  test("rejects duplicate starts while a script is running", async () => {
    const { processPort } = createProcessPort();
    const service = createDevServerService({
      processPort,
      taskWorktreeService: {
        async getTaskWorktree() {
          return { workingDirectory: "/worktrees/task-1" };
        },
      },
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });

    await service.start({ repoPath: "/repo", taskId: "task-1" });

    await expect(service.start({ repoPath: "/repo", taskId: "task-1" })).rejects.toThrow(
      "Dev servers are already running for task task-1. Stop or restart them instead.",
    );
  });

  test("requires a builder worktree before starting scripts", async () => {
    const { processPort } = createProcessPort();
    const service = createDevServerService({
      processPort,
      taskWorktreeService: {
        async getTaskWorktree() {
          return null;
        },
      },
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });

    await expect(service.start({ repoPath: "/repo", taskId: "task-1" })).rejects.toThrow(
      "Builder continuation cannot start until a builder worktree exists for task task-1. Start Builder first.",
    );
  });

  test("fails start when no dev server scripts are configured", async () => {
    const { processPort } = createProcessPort();
    const service = createDevServerService({
      processPort,
      taskWorktreeService: {
        async getTaskWorktree() {
          return { workingDirectory: "/worktrees/task-1" };
        },
      },
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig({ devServers: [] })),
    });

    await expect(service.start({ repoPath: "/repo", taskId: "task-1" })).rejects.toThrow(
      "No builder dev server scripts are configured for /canonical/repo. Add them in repository settings first.",
    );
  });

  test("keeps successful scripts running when another script fails to start", async () => {
    const processPort: DevServerProcessPort = {
      async start(input) {
        if (input.command === "exit 42") {
          throw new DevServerProcessStartExitError(42, null);
        }

        return {
          pid: 501,
          async stop() {},
        };
      },
    };
    const service = createDevServerService({
      processPort,
      taskWorktreeService: {
        async getTaskWorktree() {
          return { workingDirectory: "/worktrees/task-1" };
        },
      },
      workspaceSettingsService: createWorkspaceSettingsService(
        repoConfig({
          devServers: [
            { id: "web", name: "Web", command: "bun run dev" },
            { id: "api", name: "API", command: "exit 42" },
          ],
        }),
      ),
    });

    await expect(service.start({ repoPath: "/repo", taskId: "task-1" })).resolves.toMatchObject({
      scripts: [
        { scriptId: "web", status: "running", pid: 501 },
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
      async start(input) {
        input.onExit({ pid: 601, exitCode: 9, signal: null, error: null });
        return {
          pid: 601,
          async stop() {},
        };
      },
    };
    const service = createDevServerService({
      processPort,
      taskWorktreeService: {
        async getTaskWorktree() {
          return { workingDirectory: "/worktrees/task-1" };
        },
      },
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });

    await expect(service.start({ repoPath: "/repo", taskId: "task-1" })).rejects.toThrow(
      "Dev server exited with code 9.",
    );
    await expect(service.getState({ repoPath: "/repo", taskId: "task-1" })).resolves.toMatchObject({
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
      taskWorktreeService: {
        async getTaskWorktree() {
          return { workingDirectory: "/worktrees/task-1" };
        },
      },
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });
    await service.start({ repoPath: "/repo", taskId: "task-1" });

    await expect(service.stop({ repoPath: "/repo", taskId: "task-1" })).resolves.toMatchObject({
      scripts: [{ scriptId: "web", status: "stopped", pid: null }],
    });
    expect(stoppedPids).toEqual([400]);
  });

  test("stops all running task dev server groups during host shutdown", async () => {
    const { processPort, stoppedPids } = createProcessPort();
    const service = createDevServerService({
      processPort,
      taskWorktreeService: {
        async getTaskWorktree() {
          return { workingDirectory: "/worktrees/task" };
        },
      },
      workspaceSettingsService: createWorkspaceSettingsService(repoConfig()),
    });
    await service.start({ repoPath: "/repo", taskId: "task-1" });
    await service.start({ repoPath: "/repo", taskId: "task-2" });

    await expect(service.stopAll()).resolves.toEqual({
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
});
