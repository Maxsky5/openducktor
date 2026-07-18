import { describe, expect, test } from "bun:test";
import type {
  AgentSessionRecord,
  GitBranch,
  RepoConfig,
  TaskCard,
  TaskMetadataPayload,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { TaskActivityGuardPort } from "../../ports/task-activity-guard-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";
import type { DevServerService } from "../dev-servers/dev-server-service";
import { TerminalServiceError } from "../terminals/terminal-service";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-service";
import {
  type CreateTaskServiceInput,
  createTaskService as createProductionTaskService,
} from "./task-service";
import type { TaskWorktreeService } from "./worktrees/task-worktree-service";

const run = <A>(effect: Effect.Effect<A, unknown>): Promise<A> => Effect.runPromise(effect);

const createTaskService = (input: CreateTaskServiceInput) =>
  createProductionTaskService({
    ...input,
    terminalService:
      input.terminalService ??
      ({
        acquireTaskCleanup: () => Effect.succeed({ closedTerminalIds: [] }),
      } satisfies NonNullable<CreateTaskServiceInput["terminalService"]>),
  });

const task = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  id: "task-1",
  title: "Task",
  description: "",
  status: "open",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  labels: [],
  subtaskIds: [],
  availableActions: [],
  documentSummary: {
    spec: { has: true },
    plan: { has: true },
    qaReport: { has: true, verdict: "approved" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: true },
    planner: { required: false, canSkip: true, available: true, completed: true },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: true, completed: false },
  },
  pullRequest: {
    providerId: "github",
    number: 12,
    url: "https://github.com/acme/repo/pull/12",
    state: "open",
    createdAt: "2026-05-10T10:00:00.000Z",
    updatedAt: "2026-05-10T11:00:00.000Z",
  },
  updatedAt: "2026-05-10T10:00:00.000Z",
  createdAt: "2026-05-10T09:00:00.000Z",
  ...overrides,
});

const repoConfig: RepoConfig = {
  workspaceId: "workspace-1",
  workspaceName: "Workspace",
  repoPath: "/repo",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  worktreeBasePath: "/worktrees/repo",
  defaultRuntimeKind: "opencode",
  git: { providers: {} },
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
};

const createMetadata = (agentSessions: AgentSessionRecord[] = []): TaskMetadataPayload => ({
  spec: { markdown: "spec", updatedAt: "2026-05-10T10:00:00.000Z" },
  plan: { markdown: "plan", updatedAt: "2026-05-10T10:00:00.000Z" },
  qaReport: {
    markdown: "qa",
    verdict: "approved",
    updatedAt: "2026-05-10T10:00:00.000Z",
  },
  agentSessions,
});

const createTaskStore = (
  tasks: TaskCard[],
  calls: string[] = [],
  sessionsByTaskId: Record<string, AgentSessionRecord[]> = {},
): TaskStorePort =>
  ({
    listTasks: () => Effect.succeed(tasks),
    getTaskMetadata: (input: { taskId: string }) =>
      Effect.succeed(createMetadata(sessionsByTaskId[input.taskId] ?? [])),
    transitionTask: (input: { taskId: string; status: TaskCard["status"] }) => {
      const { taskId, status } = input;
      calls.push(`transition:${taskId}:${status}`);
      const current = tasks.find((entry) => entry.id === taskId);
      if (!current) {
        throw new Error(`Missing task ${taskId}`);
      }
      const updated = { ...current, status, updatedAt: "2026-05-10T12:00:00.000Z" };
      return Effect.succeed(updated);
    },
  }) as unknown as TaskStorePort;

const createSettingsConfig = (existingPaths = new Set<string>()): SettingsConfigPort =>
  ({
    defaultWorktreeBasePath: () => "/worktrees/repo",
    defaultRepoWorktreeBasePath: () => "/worktrees/repo",
    resolveConfiguredPath: (path: string) => path,
    canonicalizePath: (path: string) => Effect.succeed(path),
    pathExists: (path: string) => Effect.succeed(existingPaths.has(path)),
    join: (...paths: string[]) => paths.join("/"),
  }) as unknown as SettingsConfigPort;

const createWorkspaceSettingsService = (): WorkspaceSettingsService =>
  ({
    getRepoConfigByRepoPath: () => Effect.succeed(repoConfig),
  }) as unknown as WorkspaceSettingsService;

const createTaskWorktreeService = (workingDirectory: string | null): TaskWorktreeService => ({
  getTaskWorktree: () => Effect.succeed(workingDirectory ? { workingDirectory } : null),
});

const createWorktreeFiles = (calls: string[] = []): WorktreeFilePort =>
  ({
    resolveWorktreePath: (_repoPath: string, worktreePath: string) => worktreePath,
    pathIsWithinRoot: (root: string, candidate: string) =>
      Effect.succeed(candidate === root || candidate.startsWith(`${root}/`)),
    removePathIfPresent: (path: string) => {
      calls.push(`remove-path:${path}`);
      return Effect.succeed(undefined);
    },
  }) as unknown as WorktreeFilePort;

const createDevServerService = (calls: string[] = []): DevServerService =>
  ({
    stop: (input: { taskId: string }) => {
      const { taskId } = input;
      calls.push(`stop-dev:${taskId}`);
      return Effect.succeed({ stopped: [] });
    },
  }) as unknown as DevServerService;

const createGitPort = (input: {
  calls?: string[];
  branches?: GitBranch[];
  currentBranch?: string | null;
  deleteBranchFails?: boolean;
  registered?: boolean;
}): GitPort =>
  ({
    canonicalizePath: (path: string) => Effect.succeed(path),
    isGitRepository: () => Effect.succeed(true),
    shareGitCommonDirectory: () => Effect.succeed(true),
    isRegisteredWorktree: () => Effect.succeed(input.registered ?? true),
    listBranches: () => Effect.succeed(input.branches ?? []),
    getCurrentBranch: () =>
      Effect.succeed({
        name: Object.hasOwn(input, "currentBranch") ? input.currentBranch : "odt/task-1",
      }),
    removeWorktree: (_repoPath: string, worktreePath: string) => {
      input.calls?.push(`remove-worktree:${worktreePath}`);
      return Effect.succeed(undefined);
    },
    deleteLocalBranch: (_repoPath: string, branchName: string) => {
      input.calls?.push(`delete-branch:${branchName}`);
      if (input.deleteBranchFails) {
        return Effect.fail(
          new HostOperationError({
            operation: "git.delete_branch",
            message: `Cannot delete ${branchName}`,
          }),
        );
      }
      return Effect.succeed(undefined);
    },
  }) as unknown as GitPort;

describe("TaskService.closeTask", () => {
  test("closes an open task without local cleanup and preserves returned metadata", async () => {
    const calls: string[] = [];
    const service = createTaskService({
      taskStore: createTaskStore([task()], calls),
      devServerService: createDevServerService(calls),
      gitPort: createGitPort({ calls }),
      settingsConfig: createSettingsConfig(),
      taskWorktreeService: createTaskWorktreeService(null),
      workspaceSettingsService: createWorkspaceSettingsService(),
      worktreeFiles: createWorktreeFiles(calls),
    });

    const closed = await run(service.closeTask({ repoPath: "/repo", taskId: "task-1" }));

    expect(closed.status).toBe("closed");
    expect(closed.availableActions).not.toContain("close_task");
    expect(closed.documentSummary.spec.has).toBe(true);
    expect(closed.pullRequest?.number).toBe(12);
    expect(calls).toEqual(["stop-dev:task-1", "transition:task-1:closed"]);
  });

  test("does not require task worktree service when no task worktree exists", async () => {
    const calls: string[] = [];
    const service = createTaskService({
      taskStore: createTaskStore([task()], calls),
      devServerService: createDevServerService(calls),
      gitPort: createGitPort({ calls }),
      settingsConfig: createSettingsConfig(),
      workspaceSettingsService: createWorkspaceSettingsService(),
      worktreeFiles: createWorktreeFiles(calls),
    });

    const closed = await run(service.closeTask({ repoPath: "/repo", taskId: "task-1" }));

    expect(closed.status).toBe("closed");
    expect(calls).toEqual(["stop-dev:task-1", "transition:task-1:closed"]);
  });

  test("requires task worktree service when a task worktree exists", async () => {
    const calls: string[] = [];
    const service = createTaskService({
      taskStore: createTaskStore([task()], calls),
      devServerService: createDevServerService(calls),
      gitPort: createGitPort({ calls }),
      settingsConfig: createSettingsConfig(new Set(["/worktrees/repo/task-1"])),
      workspaceSettingsService: createWorkspaceSettingsService(),
      worktreeFiles: createWorktreeFiles(calls),
    });

    await expect(run(service.closeTask({ repoPath: "/repo", taskId: "task-1" }))).rejects.toThrow(
      "Task worktree service is required for task_close.",
    );
    expect(calls).toEqual([]);
  });

  test("closes an in-progress task", async () => {
    const service = createTaskService({
      taskStore: createTaskStore([task({ status: "in_progress" })]),
      devServerService: createDevServerService(),
      gitPort: createGitPort({}),
      settingsConfig: createSettingsConfig(),
      taskWorktreeService: createTaskWorktreeService(null),
      workspaceSettingsService: createWorkspaceSettingsService(),
      worktreeFiles: createWorktreeFiles(),
    });

    const closed = await run(service.closeTask({ repoPath: "/repo", taskId: "task-1" }));

    expect(closed.status).toBe("closed");
  });

  test("returns an already closed task without requiring cleanup dependencies", async () => {
    const calls: string[] = [];
    const service = createTaskService({
      taskStore: createTaskStore([task({ status: "closed" })], calls),
    });

    const closed = await run(service.closeTask({ repoPath: "/repo", taskId: "task-1" }));

    expect(closed.status).toBe("closed");
    expect(calls).toEqual([]);
  });

  test("requires live activity guard when workflow sessions exist", async () => {
    const buildSession: AgentSessionRecord = {
      externalSessionId: "session-1",
      role: "build",
      runtimeKind: "opencode",
      startedAt: "2026-05-10T10:00:00.000Z",
      workingDirectory: "/worktrees/repo/task-1",
      selectedModel: null,
    };
    const service = createTaskService({
      taskStore: createTaskStore([task()], [], { "task-1": [buildSession] }),
    });

    await expect(run(service.closeTask({ repoPath: "/repo", taskId: "task-1" }))).rejects.toThrow(
      "task_close requires runtime session activity checks",
    );
  });

  test("stops dev servers, removes task worktree, deletes related branch, then closes", async () => {
    const calls: string[] = [];
    const service = createTaskService({
      taskStore: createTaskStore([task()], calls),
      devServerService: createDevServerService(calls),
      gitPort: createGitPort({
        calls,
        branches: [{ name: "odt/task-1", isCurrent: false, isRemote: false }],
        currentBranch: "odt/task-1",
      }),
      settingsConfig: createSettingsConfig(new Set(["/worktrees/repo/task-1"])),
      taskWorktreeService: createTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService: createWorkspaceSettingsService(),
      worktreeFiles: createWorktreeFiles(calls),
    });

    await run(service.closeTask({ repoPath: "/repo", taskId: "task-1" }));

    expect(calls).toEqual([
      "stop-dev:task-1",
      "remove-worktree:/worktrees/repo/task-1",
      "remove-path:/worktrees/repo/task-1",
      "delete-branch:odt/task-1",
      "transition:task-1:closed",
    ]);
  });

  test("requires worktree file cleanup dependencies before stopping dev servers", async () => {
    const calls: string[] = [];
    const service = createTaskService({
      taskStore: createTaskStore([task()], calls),
      devServerService: createDevServerService(calls),
      gitPort: createGitPort({
        calls,
        branches: [{ name: "odt/task-1", isCurrent: false, isRemote: false }],
        currentBranch: "odt/task-1",
      }),
      settingsConfig: createSettingsConfig(new Set(["/worktrees/repo/task-1"])),
      taskWorktreeService: createTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService: createWorkspaceSettingsService(),
    });

    await expect(run(service.closeTask({ repoPath: "/repo", taskId: "task-1" }))).rejects.toThrow(
      "Worktree file port is required for task_close.",
    );
    expect(calls).toEqual([]);
  });

  test("rejects task worktrees that resolve to the repository root before cleanup", async () => {
    const calls: string[] = [];
    const service = createTaskService({
      taskStore: createTaskStore([task()], calls),
      devServerService: createDevServerService(calls),
      gitPort: createGitPort({ calls }),
      settingsConfig: createSettingsConfig(new Set(["/repo"])),
      taskWorktreeService: createTaskWorktreeService("/repo"),
      workspaceSettingsService: createWorkspaceSettingsService(),
      worktreeFiles: createWorktreeFiles(calls),
    });

    await expect(run(service.closeTask({ repoPath: "/repo", taskId: "task-1" }))).rejects.toThrow(
      "resolves to the repository root",
    );
    expect(calls).toEqual([]);
  });

  test("skips repo-root implementation session directories while closing", async () => {
    const calls: string[] = [];
    const buildSession: AgentSessionRecord = {
      externalSessionId: "session-1",
      role: "build",
      runtimeKind: "opencode",
      startedAt: "2026-05-10T10:00:00.000Z",
      workingDirectory: "/repo",
      selectedModel: null,
    };
    const activityGuard: TaskActivityGuardPort = {
      ensureNoActiveTaskDeleteRuns: () => Effect.succeed(undefined),
      ensureNoActiveTaskResetActivity: () => Effect.succeed(undefined),
    };
    const service = createTaskService({
      taskStore: createTaskStore([task()], calls, { "task-1": [buildSession] }),
      taskActivityGuard: activityGuard,
      devServerService: createDevServerService(calls),
      gitPort: createGitPort({ calls }),
      settingsConfig: createSettingsConfig(new Set(["/repo"])),
      taskWorktreeService: createTaskWorktreeService(null),
      workspaceSettingsService: createWorkspaceSettingsService(),
      worktreeFiles: createWorktreeFiles(calls),
    });

    const closed = await run(service.closeTask({ repoPath: "/repo", taskId: "task-1" }));

    expect(closed.status).toBe("closed");
    expect(calls).toEqual(["stop-dev:task-1", "transition:task-1:closed"]);
  });

  test("rejects detached or unnamed task worktrees before cleanup", async () => {
    const calls: string[] = [];
    const service = createTaskService({
      taskStore: createTaskStore([task()], calls),
      devServerService: createDevServerService(calls),
      gitPort: createGitPort({ calls, currentBranch: null }),
      settingsConfig: createSettingsConfig(new Set(["/worktrees/repo/task-1"])),
      taskWorktreeService: createTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService: createWorkspaceSettingsService(),
      worktreeFiles: createWorktreeFiles(calls),
    });

    await expect(run(service.closeTask({ repoPath: "/repo", taskId: "task-1" }))).rejects.toThrow(
      "is not on its task branch",
    );
    expect(calls).toEqual([]);
  });

  test("rejects task worktrees on unrelated branches before cleanup", async () => {
    const calls: string[] = [];
    const service = createTaskService({
      taskStore: createTaskStore([task()], calls),
      devServerService: createDevServerService(calls),
      gitPort: createGitPort({ calls, currentBranch: "feature/other" }),
      settingsConfig: createSettingsConfig(new Set(["/worktrees/repo/task-1"])),
      taskWorktreeService: createTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService: createWorkspaceSettingsService(),
      worktreeFiles: createWorktreeFiles(calls),
    });

    await expect(run(service.closeTask({ repoPath: "/repo", taskId: "task-1" }))).rejects.toThrow(
      "is not on its task branch",
    );
    expect(calls).toEqual([]);
  });

  test("retains an unrelated repository at the canonical managed path", async () => {
    const calls: string[] = [];
    const service = createTaskService({
      taskStore: createTaskStore([task()], calls),
      devServerService: createDevServerService(calls),
      gitPort: createGitPort({ calls, currentBranch: "odt/task-1", registered: false }),
      settingsConfig: createSettingsConfig(new Set(["/worktrees/repo/task-1"])),
      taskWorktreeService: createTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService: createWorkspaceSettingsService(),
      worktreeFiles: createWorktreeFiles(calls),
    });

    await expect(run(service.closeTask({ repoPath: "/repo", taskId: "task-1" }))).rejects.toThrow(
      "is not a registered worktree",
    );
    expect(calls).toEqual([]);
  });

  test("dedupes task and session worktree paths before cleanup", async () => {
    const calls: string[] = [];
    const buildSession: AgentSessionRecord = {
      externalSessionId: "session-1",
      role: "build",
      runtimeKind: "opencode",
      startedAt: "2026-05-10T10:00:00.000Z",
      workingDirectory: "/worktrees/repo/task-1/",
      selectedModel: null,
    };
    const activityGuard: TaskActivityGuardPort = {
      ensureNoActiveTaskDeleteRuns: () => Effect.succeed(undefined),
      ensureNoActiveTaskResetActivity: () => Effect.succeed(undefined),
    };
    const service = createTaskService({
      taskStore: createTaskStore([task()], calls, { "task-1": [buildSession] }),
      taskActivityGuard: activityGuard,
      devServerService: createDevServerService(calls),
      gitPort: createGitPort({
        calls,
        branches: [{ name: "odt/task-1", isCurrent: false, isRemote: false }],
        currentBranch: "odt/task-1",
      }),
      settingsConfig: createSettingsConfig(new Set(["/worktrees/repo/task-1"])),
      taskWorktreeService: createTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService: createWorkspaceSettingsService(),
      worktreeFiles: createWorktreeFiles(calls),
    });

    await run(service.closeTask({ repoPath: "/repo", taskId: "task-1" }));

    expect(calls).toEqual([
      "stop-dev:task-1",
      "remove-worktree:/worktrees/repo/task-1",
      "remove-path:/worktrees/repo/task-1",
      "delete-branch:odt/task-1",
      "transition:task-1:closed",
    ]);
  });

  test("reports cleanup progress when branch deletion fails after worktree removal", async () => {
    const calls: string[] = [];
    const service = createTaskService({
      taskStore: createTaskStore([task()], calls),
      devServerService: createDevServerService(calls),
      gitPort: createGitPort({
        calls,
        branches: [{ name: "odt/task-1", isCurrent: false, isRemote: false }],
        currentBranch: "odt/task-1",
        deleteBranchFails: true,
      }),
      settingsConfig: createSettingsConfig(new Set(["/worktrees/repo/task-1"])),
      taskWorktreeService: createTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService: createWorkspaceSettingsService(),
      worktreeFiles: createWorktreeFiles(calls),
    });

    await expect(run(service.closeTask({ repoPath: "/repo", taskId: "task-1" }))).rejects.toThrow(
      "Close cleanup already removed worktrees: /worktrees/repo/task-1.",
    );
    expect(calls).not.toContain("transition:task-1:closed");
  });

  test("uses the active workflow guard when workflow sessions exist", async () => {
    const calls: string[] = [];
    const qaSession: AgentSessionRecord = {
      externalSessionId: "session-1",
      role: "qa",
      runtimeKind: "opencode",
      startedAt: "2026-05-10T10:00:00.000Z",
      workingDirectory: "/worktrees/repo/task-1",
      selectedModel: null,
    };
    const activityGuard: TaskActivityGuardPort = {
      ensureNoActiveTaskDeleteRuns: () => Effect.succeed(undefined),
      ensureNoActiveTaskResetActivity: (input) => {
        calls.push(`${input.operationLabel}:${input.repoPath}:${input.sessionRoles.join(",")}`);
        return Effect.succeed(undefined);
      },
    };
    const service = createTaskService({
      taskStore: createTaskStore([task()], calls, { "task-1": [qaSession] }),
      taskActivityGuard: activityGuard,
      devServerService: createDevServerService(calls),
      gitPort: createGitPort({ calls }),
      settingsConfig: createSettingsConfig(),
      taskWorktreeService: createTaskWorktreeService(null),
      workspaceSettingsService: createWorkspaceSettingsService(),
      worktreeFiles: createWorktreeFiles(calls),
    });

    await run(service.closeTask({ repoPath: "/repo-alias", taskId: "task-1" }));

    expect(calls[0]).toBe("close task:/repo:spec,planner,build,qa");
  });

  test("aborts destructive cleanup when task terminal termination fails", async () => {
    const calls: string[] = [];
    const service = createTaskService({
      taskStore: createTaskStore([task()], calls),
      devServerService: createDevServerService(calls),
      gitPort: createGitPort({ calls }),
      settingsConfig: createSettingsConfig(),
      taskWorktreeService: createTaskWorktreeService(null),
      terminalService: {
        acquireTaskCleanup: ({ repoPath, taskIds }) => {
          calls.push(`terminals:${repoPath}:${taskIds.join(",")}`);
          return Effect.fail(
            new TerminalServiceError({
              code: "close_failed",
              operation: "close_by_task",
              message: "Failed terminal terminal-1.",
              details: { terminalIds: ["terminal-1"] },
            }),
          );
        },
      },
      workspaceSettingsService: createWorkspaceSettingsService(),
      worktreeFiles: createWorktreeFiles(calls),
    });

    await expect(run(service.closeTask({ repoPath: "/repo", taskId: "task-1" }))).rejects.toThrow(
      "terminal-1",
    );
    expect(calls).toContain("terminals:/repo:task-1");
    expect(calls).not.toContain("stop-dev:task-1");
    expect(calls).not.toContain("transition:task-1:closed");
  });

  test("holds task terminal cleanup admission through destructive close cleanup", async () => {
    const calls: string[] = [];
    const service = createTaskService({
      taskStore: createTaskStore([task()], calls),
      devServerService: createDevServerService(calls),
      gitPort: createGitPort({ calls }),
      settingsConfig: createSettingsConfig(),
      taskWorktreeService: createTaskWorktreeService(null),
      terminalService: {
        acquireTaskCleanup: ({ repoPath, taskIds }) =>
          Effect.acquireRelease(
            Effect.sync(() => calls.push(`terminals:acquire:${repoPath}:${taskIds.join(",")}`)),
            () => Effect.sync(() => calls.push("terminals:release")),
          ).pipe(Effect.as({ closedTerminalIds: ["terminal-1"] })),
      },
      workspaceSettingsService: createWorkspaceSettingsService(),
      worktreeFiles: createWorktreeFiles(calls),
    });

    await run(service.closeTask({ repoPath: "/repo", taskId: "task-1" }));

    expect(calls.indexOf("terminals:acquire:/repo:task-1")).toBeLessThan(
      calls.indexOf("stop-dev:task-1"),
    );
    expect(calls.indexOf("terminals:release")).toBeGreaterThan(
      calls.indexOf("transition:task-1:closed"),
    );
  });

  test("guards and cleans legacy Planner worktrees", async () => {
    const calls: string[] = [];
    const specSession: AgentSessionRecord = {
      externalSessionId: "session-1",
      role: "spec",
      runtimeKind: "opencode",
      startedAt: "2026-05-10T10:00:00.000Z",
      workingDirectory: "/repo",
      selectedModel: null,
    };
    const plannerSession: AgentSessionRecord = {
      externalSessionId: "session-2",
      role: "planner",
      runtimeKind: "opencode",
      startedAt: "2026-05-10T10:00:00.000Z",
      workingDirectory: "/worktrees/repo/planner-session",
      selectedModel: null,
    };
    const activityGuard: TaskActivityGuardPort = {
      ensureNoActiveTaskDeleteRuns: () => Effect.succeed(undefined),
      ensureNoActiveTaskResetActivity: (input) => {
        calls.push(`${input.operationLabel}:${input.sessionRoles.join(",")}`);
        return Effect.succeed(undefined);
      },
    };
    const service = createTaskService({
      taskStore: createTaskStore([task()], calls, {
        "task-1": [specSession, plannerSession],
      }),
      taskActivityGuard: activityGuard,
      devServerService: createDevServerService(calls),
      gitPort: createGitPort({
        calls,
        currentBranch: "odt/task-1-legacy",
      }),
      settingsConfig: createSettingsConfig(new Set(["/repo", "/worktrees/repo/planner-session"])),
      taskWorktreeService: createTaskWorktreeService(null),
      workspaceSettingsService: createWorkspaceSettingsService(),
      worktreeFiles: createWorktreeFiles(calls),
    });

    const closed = await run(service.closeTask({ repoPath: "/repo", taskId: "task-1" }));

    expect(closed.status).toBe("closed");
    expect(calls).toEqual([
      "close task:spec,planner,build,qa",
      "stop-dev:task-1",
      "remove-worktree:/worktrees/repo/planner-session",
      "remove-path:/worktrees/repo/planner-session",
      "transition:task-1:closed",
    ]);
  });
});
