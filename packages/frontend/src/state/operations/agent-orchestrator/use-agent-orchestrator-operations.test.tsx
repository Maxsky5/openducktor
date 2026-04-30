import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import {
  type AgentSessionRecord,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeInstanceSummary,
  type TaskCard,
} from "@openducktor/contracts";
import { toast } from "sonner";
import { clearAppQueryClient } from "@/lib/query-client";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
import { host } from "../shared/host";
import { createSessionMessagesState } from "./support/messages";
import { useAgentOrchestratorOperations } from "./use-agent-orchestrator-operations";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const withSuppressedRendererWarning = async (run: () => Promise<void>) => {
  await run();
};

const withSuppressedReattachWarning = async (run: () => Promise<void>) => {
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (...args: Parameters<typeof console.warn>): void => {
    const [firstArg] = args;
    if (
      typeof firstArg === "string" &&
      firstArg.startsWith("Failed to reconcile agent sessions for task")
    ) {
      return;
    }
    originalWarn(...args);
  };
  console.error = (...args: Parameters<typeof console.error>): void => {
    const [firstArg] = args;
    if (
      typeof firstArg === "string" &&
      firstArg.startsWith("Failed to reconcile agent sessions for task")
    ) {
      return;
    }
    originalError(...args);
  };

  try {
    await run();
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
};

const taskFixture: TaskCard = {
  id: "task-1",
  title: "Task",
  description: "",
  notes: "",
  status: "open",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-02-22T08:00:00.000Z",
  createdAt: "2026-02-22T08:00:00.000Z",
};

const taskFixture2: TaskCard = {
  ...taskFixture,
  id: "task-2",
  title: "Task 2",
};

const originalBuildContinuationTargetGet = host.taskWorktreeGet;

beforeEach(async () => {
  await clearAppQueryClient();
  host.taskWorktreeGet = async () => ({
    workingDirectory: "/tmp/repo/worktree",
  });
});

afterEach(() => {
  host.taskWorktreeGet = originalBuildContinuationTargetGet;
});

const persistedSessionFixture: AgentSessionRecord = {
  runtimeKind: "opencode",
  externalSessionId: "external-1",
  role: "build",
  scenario: "build_implementation_start",
  startedAt: "2026-02-22T08:00:00.000Z",
  workingDirectory: "/tmp/repo/worktree",
  selectedModel: null,
};

const persistedBuildSessionFixture: AgentSessionRecord = {
  ...persistedSessionFixture,
  workingDirectory: "/tmp/repo/worktree",
};

const taskFixtureWithPersistedBuildSession: TaskCard = {
  ...taskFixture,
  agentSessions: [persistedBuildSessionFixture],
};

const taskFixture2WithPersistedBuildSession: TaskCard = {
  ...taskFixture2,
  agentSessions: [
    {
      ...persistedBuildSessionFixture,
      externalSessionId: "external-2",
    },
  ],
};

const buildBootstrapFixture = {
  runtimeKind: "opencode",
  runtimeId: "runtime-build",
  runtimeRoute: {
    type: "local_http" as const,
    endpoint: "http://127.0.0.1:4444",
  },
  workingDirectory: "/tmp/repo/worktree",
};

const createWorktreeRuntimeFixture = (
  overrides: Partial<RuntimeInstanceSummary> = {},
): RuntimeInstanceSummary => ({
  kind: "opencode",
  runtimeId: "runtime-1",
  repoPath: "/tmp/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/tmp/repo/worktree",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4444",
  },
  startedAt: "2026-02-22T08:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
  ...overrides,
});

const BUILD_SELECTION = {
  runtimeKind: "opencode" as const,
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "build",
};

const createDeferred = <T,>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    promise,
    resolve: (value: T) => {
      resolve?.(value);
    },
    reject: (reason?: unknown) => {
      reject?.(reason);
    },
  };
};

const createHookHarness = (args: {
  activeRepo: string | null;
  activeWorkspace?: import("@openducktor/contracts").WorkspaceRecord | null;
  tasks: TaskCard[];
  refreshTaskData: (repoPath: string) => Promise<void>;
  agentEngine?: OpencodeSdkAdapter;
}) => {
  const createDefaultActiveWorkspace = (activeRepo: string | null) =>
    activeRepo === null
      ? null
      : {
          workspaceId: activeRepo.split("/").filter(Boolean).at(-1) ?? "workspace",
          workspaceName: "Workspace",
          repoPath: activeRepo,
          branchPrefix: "odt",
          defaultRuntimeKind: "opencode",
          defaultTargetBranch: null,
          defaultBuildProfileId: null,
          defaultBuildProvider: null,
          defaultBuildModel: null,
          defaultBuildVariant: null,
          defaultQaProfileId: null,
          defaultQaProvider: null,
          defaultQaModel: null,
          defaultQaVariant: null,
          git: { providers: {} },
          hooks: { preStart: [], postComplete: [] },
          isActive: true,
          hasConfig: true,
          defaultWorktreeBasePath: null,
          configuredWorktreeBasePath: null,
          effectiveWorktreeBasePath: null,
        };
  let latest: ReturnType<typeof useAgentOrchestratorOperations> | null = null;
  let currentArgs = {
    ...args,
    activeWorkspace: args.activeWorkspace ?? createDefaultActiveWorkspace(args.activeRepo),
    agentEngine: args.agentEngine ?? new OpencodeSdkAdapter(),
  };

  const Harness = () => {
    latest = useAgentOrchestratorOperations(currentArgs);
    return null;
  };

  const sharedHarness = createSharedHookHarness(Harness, undefined);

  const mount = async () => {
    await sharedHarness.mount();
  };

  const unmount = async () => {
    try {
      await sharedHarness.unmount();
    } finally {
      latest = null;
    }
  };

  const updateArgs = async (
    nextArgs: Partial<{
      activeRepo: string | null;
      activeWorkspace: import("@openducktor/contracts").WorkspaceRecord | null;
      tasks: TaskCard[];
      refreshTaskData: (repoPath: string) => Promise<void>;
      agentEngine: OpencodeSdkAdapter;
    }>,
  ) => {
    currentArgs = {
      ...currentArgs,
      ...nextArgs,
      activeWorkspace:
        nextArgs.activeRepo !== undefined && nextArgs.activeWorkspace === undefined
          ? createDefaultActiveWorkspace(nextArgs.activeRepo)
          : currentArgs.activeWorkspace,
    };
    await sharedHarness.update(undefined);
  };

  const run = async (callback: () => Promise<void> | void) => {
    await sharedHarness.run(async () => {
      await callback();
    });
  };

  const waitFor = async (
    predicate: (state: ReturnType<typeof useAgentOrchestratorOperations>) => boolean,
  ) => {
    await sharedHarness.waitFor(() => latest !== null && predicate(latest));

    if (!latest) {
      throw new Error("Hook state unavailable");
    }

    return latest;
  };

  const getLatest = () => {
    if (!latest) {
      throw new Error("Hook state unavailable");
    }
    return latest;
  };

  return {
    mount,
    unmount,
    updateArgs,
    run,
    waitFor,
    getLatest,
  };
};

describe("use-agent-orchestrator-operations", () => {
  const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
  const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;
  const originalRuntimeList = host.runtimeList;
  const originalRuntimeEnsure = host.runtimeEnsure;
  const originalListLiveAgentSessionSnapshots =
    OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots;

  beforeEach(() => {
    host.workspaceGetRepoConfig = async () =>
      ({
        workspaceId: "repo",
        workspaceName: "Repo",
        repoPath: "/tmp/repo",
        defaultRuntimeKind: "opencode",
        branchPrefix: "odt",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: { providers: {} },
        hooks: { preStart: [], postComplete: [] },
        devServers: [],
        worktreeCopyPaths: [],
        promptOverrides: {},
        agentDefaults: {},
      }) as Awaited<ReturnType<typeof host.workspaceGetRepoConfig>>;
    host.workspaceGetSettingsSnapshot = async () => ({
      theme: "light" as const,
      git: {
        defaultMergeMethod: "merge_commit",
      },
      chat: {
        showThinkingMessages: false,
      },
      kanban: {
        doneVisibleDays: 1,
        emptyColumnDisplay: "show",
      },
      autopilot: {
        rules: [],
      },
      workspaces: {},
      globalPromptOverrides: {},
    });
    host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo/worktree",
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];
    host.runtimeEnsure = async (repoPath, runtimeKind) => ({
      kind: runtimeKind,
      runtimeId: "runtime-1",
      repoPath,
      taskId: null,
      role: "workspace",
      workingDirectory: repoPath,
      runtimeRoute: {
        type: "local_http",
        endpoint: "http://127.0.0.1:4444",
      },
      startedAt: "2026-02-22T08:00:00.000Z",
      descriptor: {
        ...OPENCODE_RUNTIME_DESCRIPTOR,
        kind: runtimeKind,
      },
    });
    OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots = async () => [];
  });

  afterEach(() => {
    host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
    host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
    host.runtimeList = originalRuntimeList;
    host.runtimeEnsure = originalRuntimeEnsure;
    OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots =
      originalListLiveAgentSessionSnapshots;
  });

  test("reattaches listener before send when adapter session exists", async () => {
    let subscribeCalls = 0;
    let sendCalls = 0;

    await withSuppressedRendererWarning(async () => {
      const originalAgentSessionsList = host.agentSessionsList;
      const originalAgentSessionUpsert = host.agentSessionUpsert;
      const originalSpecGet = host.specGet;
      const originalPlanGet = host.planGet;
      const originalQaGetReport = host.qaGetReport;
      const originalBuildContinuationTargetGet = host.taskWorktreeGet;

      const originalHasSession = OpencodeSdkAdapter.prototype.hasSession;
      const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
      const originalSendUserMessage = OpencodeSdkAdapter.prototype.sendUserMessage;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
      const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

      host.agentSessionsList = async () => [persistedBuildSessionFixture];
      host.agentSessionUpsert = async () => {};
      host.specGet = async () => ({ markdown: "", updatedAt: null });
      host.planGet = async () => ({ markdown: "", updatedAt: null });
      host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
      host.taskWorktreeGet = async () => ({
        workingDirectory: "/tmp/repo/worktree",
        source: "active_build_run",
      });

      OpencodeSdkAdapter.prototype.hasSession = () => true;
      OpencodeSdkAdapter.prototype.subscribeEvents = (_externalSessionId, _listener) => {
        subscribeCalls += 1;
        return () => {};
      };
      OpencodeSdkAdapter.prototype.sendUserMessage = async () => {
        sendCalls += 1;
      };
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
      OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixture],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();

        await harness.run(async () => {
          await harness.getLatest().loadAgentSessions("task-1");
        });

        const sessionState = await harness.waitFor((state) => state.sessions.length === 1);
        const externalSessionId = sessionState.sessions[0]?.externalSessionId;
        if (!externalSessionId) {
          throw new Error("Expected hydrated session id");
        }

        await harness.run(async () => {
          await harness
            .getLatest()
            .sendAgentMessage(externalSessionId, [{ kind: "text", text: "hello" }]);
        });

        expect(subscribeCalls).toBeGreaterThan(0);
        expect(sendCalls).toBe(1);
      } finally {
        await harness.unmount();

        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.specGet = originalSpecGet;
        host.planGet = originalPlanGet;
        host.qaGetReport = originalQaGetReport;
        host.taskWorktreeGet = originalBuildContinuationTargetGet;

        OpencodeSdkAdapter.prototype.hasSession = originalHasSession;
        OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
        OpencodeSdkAdapter.prototype.sendUserMessage = originalSendUserMessage;
        OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
        OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
        OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      }
    });
  });

  test("does not attach a duplicate session listener when the same live session is reconciled twice", async () => {
    let subscribeCalls = 0;
    const hasAttachedSession = true;

    await withSuppressedRendererWarning(async () => {
      const originalAgentSessionsList = host.agentSessionsList;
      const originalAgentSessionUpsert = host.agentSessionUpsert;
      const originalRuntimeList = host.runtimeList;
      const originalHasSession = OpencodeSdkAdapter.prototype.hasSession;
      const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
      const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;

      host.agentSessionsList = async () => [persistedBuildSessionFixture];
      host.agentSessionUpsert = async () => {};
      host.runtimeList = async () => [
        {
          kind: "opencode",
          runtimeId: "runtime-1",
          repoPath: "/tmp/repo",
          taskId: null,
          role: "workspace",
          workingDirectory: "/tmp/repo/worktree",
          runtimeRoute: {
            type: "local_http" as const,
            endpoint: "http://127.0.0.1:4444",
          },
          startedAt: "2026-02-22T08:00:00.000Z",
          descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        },
      ];

      OpencodeSdkAdapter.prototype.hasSession = () => hasAttachedSession;
      OpencodeSdkAdapter.prototype.resumeSession = async (input) => {
        return {
          externalSessionId: input.externalSessionId,
          role: input.role,
          scenario: input.scenario,
          startedAt: "2026-02-22T08:00:00.000Z",
          status: "running",
          runtimeKind: input.runtimeKind,
        };
      };
      OpencodeSdkAdapter.prototype.subscribeEvents = () => {
        subscribeCalls += 1;
        return () => {};
      };
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots = async () => [
        {
          externalSessionId: "external-1",
          title: "PLANNER task-1",
          workingDirectory: "/tmp/repo/worktree",
          startedAt: "2026-02-22T08:00:00.000Z",
          status: { type: "busy" },
          pendingPermissions: [],
          pendingQuestions: [],
        },
      ];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [
          {
            ...taskFixture,
            agentSessions: [persistedBuildSessionFixture],
          },
        ],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        await harness.waitFor(() => subscribeCalls === 1);

        await harness.run(async () => {
          await harness.getLatest().reconcileLiveTaskSessions({
            taskId: "task-1",
            persistedRecords: [persistedBuildSessionFixture],
          });
        });

        expect(subscribeCalls).toBe(1);
      } finally {
        await harness.unmount();
        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.runtimeList = originalRuntimeList;
        OpencodeSdkAdapter.prototype.hasSession = originalHasSession;
        OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
        OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
        OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
        OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      }
    });
  });

  test("shows error toast when send is rejected for an unavailable role", async () => {
    await withSuppressedRendererWarning(async () => {
      let sendCalls = 0;

      const originalToastError = toast.error;
      const toastError = mock(() => "");
      toast.error = toastError;

      const originalAgentSessionsList = host.agentSessionsList;
      const originalAgentSessionUpsert = host.agentSessionUpsert;
      const originalSpecGet = host.specGet;
      const originalPlanGet = host.planGet;
      const originalQaGetReport = host.qaGetReport;
      const originalBuildContinuationTargetGet = host.taskWorktreeGet;

      const originalHasSession = OpencodeSdkAdapter.prototype.hasSession;
      const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
      const originalSendUserMessage = OpencodeSdkAdapter.prototype.sendUserMessage;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
      const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

      host.agentSessionsList = async () => [persistedSessionFixture];
      host.agentSessionUpsert = async () => {};
      host.specGet = async () => ({ markdown: "", updatedAt: null });
      host.planGet = async () => ({ markdown: "", updatedAt: null });
      host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
      host.taskWorktreeGet = async () => ({
        workingDirectory: "/tmp/repo/worktree",
        source: "active_build_run",
      });

      OpencodeSdkAdapter.prototype.hasSession = () => true;
      OpencodeSdkAdapter.prototype.subscribeEvents = () => () => {};
      OpencodeSdkAdapter.prototype.sendUserMessage = async () => {
        sendCalls += 1;
      };
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
      OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

      const unavailableTask: TaskCard = {
        ...taskFixture,
        status: "open",
        agentWorkflows: {
          spec: { required: true, canSkip: false, available: true, completed: false },
          planner: { required: true, canSkip: false, available: false, completed: false },
          builder: { required: true, canSkip: false, available: false, completed: false },
          qa: { required: true, canSkip: false, available: false, completed: false },
        },
      };

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [unavailableTask],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        await harness.run(async () => {
          await harness.getLatest().loadAgentSessions("task-1");
        });

        await harness.run(async () => {
          await expect(
            harness.getLatest().sendAgentMessage("external-1", [{ kind: "text", text: "hello" }]),
          ).rejects.toThrow("Role 'build' is unavailable for task 'task-1' in status 'open'.");
        });

        expect(sendCalls).toBe(0);
        expect(toastError).toHaveBeenCalledWith("Failed to send message", {
          description: "Role 'build' is unavailable for task 'task-1' in status 'open'.",
        });
      } finally {
        await harness.unmount();

        toast.error = originalToastError;
        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.specGet = originalSpecGet;
        host.planGet = originalPlanGet;
        host.qaGetReport = originalQaGetReport;
        host.taskWorktreeGet = originalBuildContinuationTargetGet;

        OpencodeSdkAdapter.prototype.hasSession = originalHasSession;
        OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
        OpencodeSdkAdapter.prototype.sendUserMessage = originalSendUserMessage;
        OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
        OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
        OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      }
    });
  });

  test("reuses an in-memory session after it has been started", async () => {
    await withSuppressedRendererWarning(async () => {
      let startCalls = 0;
      let persistedListCalls = 0;

      const originalAgentSessionsList = host.agentSessionsList;
      const originalAgentSessionUpsert = host.agentSessionUpsert;
      const originalSpecGet = host.specGet;
      const originalPlanGet = host.planGet;
      const originalQaGetReport = host.qaGetReport;
      const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
      const originalBuildStart = host.buildStart;
      const originalBuildContinuationTargetGet = host.taskWorktreeGet;

      const originalStartSession = OpencodeSdkAdapter.prototype.startSession;
      const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;

      host.agentSessionsList = async () => {
        persistedListCalls += 1;
        return [];
      };
      host.agentSessionUpsert = async () => {};
      host.specGet = async () => ({ markdown: "", updatedAt: null });
      host.planGet = async () => ({ markdown: "", updatedAt: null });
      host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
      host.workspaceGetRepoConfig = async () => ({
        workspaceId: "repo",
        workspaceName: "Repo",
        repoPath: "/tmp/repo",
        defaultRuntimeKind: "opencode" as const,
        branchPrefix: "obp",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: {
          providers: {},
        },
        hooks: {
          preStart: [],
          postComplete: [],
        },
        devServers: [],
        worktreeCopyPaths: [],
        promptOverrides: {},
        agentDefaults: {},
      });
      host.buildStart = async () => buildBootstrapFixture;
      host.taskWorktreeGet = async () => ({
        workingDirectory: "/tmp/repo/worktree",
      });

      OpencodeSdkAdapter.prototype.startSession = async () => {
        startCalls += 1;
        return {
          runtimeKind: "opencode",
          externalSessionId: "external-in-memory",
          startedAt: "2026-02-22T08:00:00.000Z",
          role: "build",
          scenario: "build_after_human_request_changes",
          status: "idle",
        };
      };
      OpencodeSdkAdapter.prototype.subscribeEvents = (_externalSessionId, _listener) => () => {};
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixture],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();

        let firstSessionId = "";
        await harness.run(async () => {
          firstSessionId = await harness.getLatest().startAgentSession({
            taskId: "task-1",
            role: "build",
            scenario: "build_after_human_request_changes",
            startMode: "fresh",
            selectedModel: BUILD_SELECTION,
          });
        });

        let secondSessionId = "";
        await harness.run(async () => {
          secondSessionId = await harness.getLatest().startAgentSession({
            taskId: "task-1",
            role: "build",
            scenario: "build_after_human_request_changes",
            startMode: "reuse",
            sourceExternalSessionId: "external-in-memory",
          });
        });

        expect(firstSessionId).toBe("external-in-memory");
        expect(secondSessionId).toBe("external-in-memory");
        expect(startCalls).toBe(1);
        expect(persistedListCalls).toBe(0);
      } finally {
        await harness.unmount();

        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.specGet = originalSpecGet;
        host.planGet = originalPlanGet;
        host.qaGetReport = originalQaGetReport;
        host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
        host.buildStart = originalBuildStart;
        host.taskWorktreeGet = originalBuildContinuationTargetGet;

        OpencodeSdkAdapter.prototype.startSession = originalStartSession;
        OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
        OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
        OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      }
    });
  });

  test("dedupes concurrent starts for the same repo and task", async () => {
    await withSuppressedRendererWarning(async () => {
      let startCalls = 0;
      let persistedListCalls = 0;
      const startDeferred = createDeferred<{
        runtimeKind: "opencode";
        externalSessionId: string;
        startedAt: string;
        role: "build";
        scenario: "build_after_human_request_changes";
        status: "idle";
      }>();

      const originalAgentSessionsList = host.agentSessionsList;
      const originalAgentSessionUpsert = host.agentSessionUpsert;
      const originalSpecGet = host.specGet;
      const originalPlanGet = host.planGet;
      const originalQaGetReport = host.qaGetReport;
      const originalBuildContinuationTargetGet = host.taskWorktreeGet;
      const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;

      const originalStartSession = OpencodeSdkAdapter.prototype.startSession;
      const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;

      host.agentSessionsList = async () => {
        persistedListCalls += 1;
        return [];
      };
      host.agentSessionUpsert = async () => {};
      host.specGet = async () => ({ markdown: "", updatedAt: null });
      host.planGet = async () => ({ markdown: "", updatedAt: null });
      host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
      host.taskWorktreeGet = async () => ({
        workingDirectory: "/tmp/repo/worktree",
        source: "active_build_run",
      });
      host.workspaceGetRepoConfig = async () => ({
        workspaceId: "repo",
        workspaceName: "Repo",
        repoPath: "/tmp/repo",
        defaultRuntimeKind: "opencode" as const,
        branchPrefix: "obp",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: {
          providers: {},
        },
        hooks: {
          preStart: [],
          postComplete: [],
        },
        devServers: [],
        worktreeCopyPaths: [],
        promptOverrides: {},
        agentDefaults: {},
      });

      OpencodeSdkAdapter.prototype.startSession = async () => {
        startCalls += 1;
        return startDeferred.promise;
      };
      OpencodeSdkAdapter.prototype.subscribeEvents = (_externalSessionId, _listener) => () => {};
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixture],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();

        let firstSessionId = "";
        let secondSessionId = "";
        await harness.run(async () => {
          const operations = harness.getLatest();
          const firstStart = operations.startAgentSession({
            taskId: "task-1",
            role: "build",
            scenario: "build_after_human_request_changes",
            startMode: "fresh",
            selectedModel: BUILD_SELECTION,
          });
          const secondStart = operations.startAgentSession({
            taskId: "task-1",
            role: "build",
            scenario: "build_after_human_request_changes",
            startMode: "fresh",
            selectedModel: BUILD_SELECTION,
          });

          startDeferred.resolve({
            runtimeKind: "opencode",
            externalSessionId: "external-concurrent",
            startedAt: "2026-02-22T08:00:00.000Z",
            role: "build",
            scenario: "build_after_human_request_changes",
            status: "idle",
          });

          [firstSessionId, secondSessionId] = await Promise.all([firstStart, secondStart]);
        });

        expect(firstSessionId).toBe("external-concurrent");
        expect(secondSessionId).toBe("external-concurrent");
        expect(startCalls).toBe(1);
        expect(persistedListCalls).toBe(0);
      } finally {
        await harness.unmount();

        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.specGet = originalSpecGet;
        host.planGet = originalPlanGet;
        host.qaGetReport = originalQaGetReport;
        host.taskWorktreeGet = originalBuildContinuationTargetGet;
        host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;

        OpencodeSdkAdapter.prototype.startSession = originalStartSession;
        OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
        OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
        OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      }
    });
  });

  test("returns persisted session for task without starting a new one", async () => {
    await withSuppressedRendererWarning(async () => {
      let startCalls = 0;

      const originalAgentSessionsList = host.agentSessionsList;
      const originalAgentSessionUpsert = host.agentSessionUpsert;
      const originalSpecGet = host.specGet;
      const originalPlanGet = host.planGet;
      const originalQaGetReport = host.qaGetReport;
      const originalRuntimeList = host.runtimeList;
      const originalRuntimeEnsure = host.runtimeEnsure;
      const originalBuildContinuationTargetGet = host.taskWorktreeGet;

      const originalStartSession = OpencodeSdkAdapter.prototype.startSession;
      const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;

      host.agentSessionsList = async () => [
        {
          ...persistedBuildSessionFixture,
          role: "build",
          scenario: "build_after_human_request_changes",
        },
      ];
      host.agentSessionUpsert = async () => {};
      host.specGet = async () => ({ markdown: "", updatedAt: null });
      host.planGet = async () => ({ markdown: "", updatedAt: null });
      host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
      host.runtimeList = async () => [
        {
          runtimeId: "runtime-1",
          kind: "opencode",
          repoPath: "/tmp/repo",
          taskId: null,
          role: "workspace",
          workingDirectory: "/tmp/repo/worktree",
          runtimeRoute: {
            type: "local_http",
            endpoint: "http://127.0.0.1:4555",
          },
          startedAt: "2026-02-22T08:00:00.000Z",
          descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        },
      ];
      host.runtimeEnsure = async () => ({
        runtimeId: "runtime-1",
        kind: "opencode",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo/worktree",
        runtimeRoute: {
          type: "local_http",
          endpoint: "http://127.0.0.1:4555",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      });
      host.taskWorktreeGet = async () => ({
        workingDirectory: "/tmp/repo/worktree",
        source: "active_build_run",
      });

      OpencodeSdkAdapter.prototype.startSession = async () => {
        startCalls += 1;
        return {
          runtimeKind: "opencode",
          externalSessionId: "external-unexpected",
          startedAt: "2026-02-22T08:00:00.000Z",
          role: "spec",
          scenario: "spec_initial",
          status: "idle",
        };
      };
      OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [
          {
            ...taskFixture,
            agentSessions: [
              {
                ...persistedSessionFixture,
                role: "spec",
                scenario: "spec_initial",
                workingDirectory: "/tmp/repo/worktree",
              },
            ],
          },
        ],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();

        let externalSessionId = "";
        await harness.run(async () => {
          externalSessionId = await harness.getLatest().startAgentSession({
            taskId: "task-1",
            role: "build",
            scenario: "build_after_human_request_changes",
            startMode: "reuse",
            sourceExternalSessionId: "external-1",
          });
        });

        expect(externalSessionId).toBe("external-1");
        expect(startCalls).toBe(0);
        await harness.waitFor((state) =>
          state.sessions.some((entry) => entry.externalSessionId === "external-1"),
        );
      } finally {
        await harness.unmount();

        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.specGet = originalSpecGet;
        host.planGet = originalPlanGet;
        host.qaGetReport = originalQaGetReport;
        host.runtimeList = originalRuntimeList;
        host.runtimeEnsure = originalRuntimeEnsure;
        host.taskWorktreeGet = originalBuildContinuationTargetGet;

        OpencodeSdkAdapter.prototype.startSession = originalStartSession;
        OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
        OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
        OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      }
    });
  });

  test("rejects stale start when active repo changes mid-flight", async () => {
    await withSuppressedRendererWarning(async () => {
      let startCalls = 0;
      const repoConfigDeferred =
        createDeferred<Awaited<ReturnType<typeof host.workspaceGetRepoConfig>>>();

      const originalAgentSessionsList = host.agentSessionsList;
      const originalBuildStart = host.buildStart;
      const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;

      const originalStartSession = OpencodeSdkAdapter.prototype.startSession;

      host.agentSessionsList = async () => [];
      host.buildStart = async () => ({
        ...buildBootstrapFixture,
        workingDirectory: "/tmp/repo-a/worktree",
      });
      host.workspaceGetRepoConfig = async () => repoConfigDeferred.promise;

      OpencodeSdkAdapter.prototype.startSession = async () => {
        startCalls += 1;
        return {
          runtimeKind: "opencode",
          externalSessionId: "external-should-not-start",
          startedAt: "2026-02-22T08:00:00.000Z",
          role: "build",
          scenario: "build_implementation_start",
          status: "idle",
        };
      };

      const harness = createHookHarness({
        activeRepo: "/tmp/repo-a",
        tasks: [taskFixture],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();

        const startPromise = harness.getLatest().startAgentSession({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        });

        await harness.updateArgs({ activeRepo: "/tmp/repo-b" });
        repoConfigDeferred.resolve({
          workspaceId: "repo-a",
          workspaceName: "Repo A",
          repoPath: "/tmp/repo-a",
          defaultRuntimeKind: "opencode" as const,
          branchPrefix: "obp",
          defaultTargetBranch: { remote: "origin", branch: "main" },
          git: {
            providers: {},
          },
          hooks: {
            preStart: [],
            postComplete: [],
          },
          devServers: [],
          worktreeCopyPaths: [],
          promptOverrides: {},
          agentDefaults: {},
        });

        let staleError: unknown = null;
        try {
          await startPromise;
        } catch (error) {
          staleError = error;
        }

        if (!(staleError instanceof Error)) {
          throw new Error("Expected stale start to reject with Error");
        }

        expect(staleError.message).toContain("Workspace changed while starting session.");
        expect(startCalls).toBe(0);
      } finally {
        await harness.unmount();

        host.agentSessionsList = originalAgentSessionsList;
        host.buildStart = originalBuildStart;
        host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;

        OpencodeSdkAdapter.prototype.startSession = originalStartSession;
      }
    });
  });

  test("keeps kickoff start successful when repo changes during background refresh", async () => {
    await withSuppressedRendererWarning(async () => {
      let startCalls = 0;
      let refreshCalls = 0;
      const refreshDeferred = createDeferred<void>();

      const originalAgentSessionsList = host.agentSessionsList;
      const originalAgentSessionUpsert = host.agentSessionUpsert;
      const originalSpecGet = host.specGet;
      const originalPlanGet = host.planGet;
      const originalQaGetReport = host.qaGetReport;
      const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;

      const originalHasSession = OpencodeSdkAdapter.prototype.hasSession;
      const originalStartSession = OpencodeSdkAdapter.prototype.startSession;
      const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
      const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
      const originalSendUserMessage = OpencodeSdkAdapter.prototype.sendUserMessage;
      const originalStopSession = OpencodeSdkAdapter.prototype.stopSession;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;

      host.agentSessionsList = async () => [];
      host.agentSessionUpsert = async () => {};
      host.specGet = async () => ({ markdown: "", updatedAt: null });
      host.planGet = async () => ({ markdown: "", updatedAt: null });
      host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
      host.workspaceGetRepoConfig = async () => ({
        workspaceId: "repo",
        workspaceName: "Repo",
        repoPath: "/tmp/repo-a",
        defaultRuntimeKind: "opencode" as const,
        branchPrefix: "obp",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: {
          providers: {},
        },
        hooks: {
          preStart: [],
          postComplete: [],
        },
        devServers: [],
        worktreeCopyPaths: [],
        promptOverrides: {},
        agentDefaults: {},
      });

      OpencodeSdkAdapter.prototype.hasSession = () => true;
      OpencodeSdkAdapter.prototype.startSession = async () => {
        startCalls += 1;
        return {
          runtimeKind: "opencode",
          externalSessionId: "external-kickoff",
          startedAt: "2026-02-22T08:00:00.000Z",
          role: "build",
          scenario: "build_implementation_start",
          status: "idle",
        };
      };
      OpencodeSdkAdapter.prototype.subscribeEvents = (_externalSessionId, _listener) => () => {};
      OpencodeSdkAdapter.prototype.sendUserMessage = async () => {};
      OpencodeSdkAdapter.prototype.stopSession = async () => {};
      OpencodeSdkAdapter.prototype.resumeSession = async (input) => ({
        runtimeKind: input.runtimeKind,
        externalSessionId: input.externalSessionId,
        startedAt: "2026-02-22T08:00:00.000Z",
        role: input.role,
        scenario: input.scenario,
        status: "idle",
      });
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo-a",
        tasks: [taskFixture],
        refreshTaskData: async () => {
          refreshCalls += 1;
          await refreshDeferred.promise;
        },
      });

      try {
        await harness.mount();

        const startPromise = harness.getLatest().startAgentSession({
          taskId: "task-1",
          role: "build",
          sendKickoff: true,
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        });

        await harness.waitFor(() => refreshCalls === 1);
        await harness.updateArgs({ activeRepo: "/tmp/repo-b" });
        refreshDeferred.resolve();

        await expect(startPromise).resolves.toBe("external-kickoff");
        expect(refreshCalls).toBe(1);
        expect(startCalls).toBe(1);
      } finally {
        await harness.unmount();

        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.specGet = originalSpecGet;
        host.planGet = originalPlanGet;
        host.qaGetReport = originalQaGetReport;
        host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;

        OpencodeSdkAdapter.prototype.hasSession = originalHasSession;
        OpencodeSdkAdapter.prototype.startSession = originalStartSession;
        OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
        OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
        OpencodeSdkAdapter.prototype.sendUserMessage = originalSendUserMessage;
        OpencodeSdkAdapter.prototype.stopSession = originalStopSession;
        OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
        OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      }
    });
  });

  test("blocks free-form sends while an attached error session is waiting for input", async () => {
    await withSuppressedRendererWarning(async () => {
      let subscribeCalls = 0;
      let unsubscribeCalls = 0;
      let stopCalls = 0;
      let resumeCalls = 0;
      let sendCalls = 0;
      let eventHandler: ((event: { type: string; [key: string]: unknown }) => void) | null = null;

      const originalAgentSessionsList = host.agentSessionsList;
      const originalAgentSessionUpsert = host.agentSessionUpsert;
      const originalSpecGet = host.specGet;
      const originalPlanGet = host.planGet;
      const originalQaGetReport = host.qaGetReport;

      const originalHasSession = OpencodeSdkAdapter.prototype.hasSession;
      const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
      const originalStopSession = OpencodeSdkAdapter.prototype.stopSession;
      const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
      const originalSendUserMessage = OpencodeSdkAdapter.prototype.sendUserMessage;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
      const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

      host.agentSessionsList = async () => [persistedSessionFixture];
      host.agentSessionUpsert = async () => {};
      host.specGet = async () => ({ markdown: "", updatedAt: null });
      host.planGet = async () => ({ markdown: "", updatedAt: null });
      host.qaGetReport = async () => ({ markdown: "", updatedAt: null });

      OpencodeSdkAdapter.prototype.hasSession = () => true;
      OpencodeSdkAdapter.prototype.subscribeEvents = (_externalSessionId, listener) => {
        subscribeCalls += 1;
        eventHandler = listener as unknown as (event: {
          type: string;
          [key: string]: unknown;
        }) => void;
        return () => {
          unsubscribeCalls += 1;
        };
      };
      OpencodeSdkAdapter.prototype.stopSession = async () => {
        stopCalls += 1;
      };
      OpencodeSdkAdapter.prototype.resumeSession = async () => {
        resumeCalls += 1;
        return {
          runtimeKind: "opencode",
          externalSessionId: "external-1",
          startedAt: "2026-02-22T08:00:00.000Z",
          role: "build",
          scenario: "build_implementation_start",
          status: "idle",
        };
      };
      OpencodeSdkAdapter.prototype.sendUserMessage = async () => {
        sendCalls += 1;
      };
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
      OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [
          {
            ...taskFixture,
            agentSessions: [
              {
                ...persistedSessionFixture,
                role: "spec",
                scenario: "spec_initial",
              },
            ],
          },
        ],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();

        await harness.run(async () => {
          await harness.getLatest().loadAgentSessions("task-1");
        });

        await harness.run(async () => {
          await harness
            .getLatest()
            .sendAgentMessage("external-1", [{ kind: "text", text: "prime" }]);
        });

        if (!eventHandler) {
          throw new Error("Expected session event handler to be registered");
        }

        await harness.run(async () => {
          eventHandler?.({
            type: "session_error",
            externalSessionId: "external-1",
            message: "boom",
            timestamp: "2026-02-22T08:00:04.000Z",
          });
          eventHandler?.({
            type: "permission_required",
            externalSessionId: "external-1",
            requestId: "perm-1",
            permission: "read",
            patterns: ["*.md"],
            metadata: { tool: "read" },
            timestamp: "2026-02-22T08:00:05.000Z",
          });
          eventHandler?.({
            type: "question_required",
            externalSessionId: "external-1",
            requestId: "question-1",
            questions: [
              {
                header: "Confirm",
                question: "Confirm",
                options: [],
                multiple: false,
                custom: false,
              },
            ],
            timestamp: "2026-02-22T08:00:05.500Z",
          });
        });

        const pendingState = await harness.waitFor(
          (state) =>
            state.sessions.find((entry) => entry.externalSessionId === "external-1")
              ?.pendingPermissions.length === 1,
        );
        const pendingSession = pendingState.sessions.find(
          (entry) => entry.externalSessionId === "external-1",
        );
        expect(pendingSession?.pendingPermissions).toHaveLength(1);
        expect(pendingSession?.pendingQuestions).toHaveLength(1);

        await harness.run(async () => {
          await harness
            .getLatest()
            .sendAgentMessage("external-1", [{ kind: "text", text: "hello" }]);
        });

        const recoveredSession = harness
          .getLatest()
          .sessions.find((entry) => entry.externalSessionId === "external-1");
        expect(stopCalls).toBe(0);
        expect(resumeCalls).toBe(0);
        expect(subscribeCalls).toBeGreaterThan(0);
        expect(unsubscribeCalls).toBe(0);
        expect(sendCalls).toBe(1);
        expect(recoveredSession?.pendingPermissions).toHaveLength(1);
        expect(recoveredSession?.pendingQuestions).toHaveLength(1);
      } finally {
        await harness.unmount();

        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.specGet = originalSpecGet;
        host.planGet = originalPlanGet;
        host.qaGetReport = originalQaGetReport;

        OpencodeSdkAdapter.prototype.hasSession = originalHasSession;
        OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
        OpencodeSdkAdapter.prototype.stopSession = originalStopSession;
        OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
        OpencodeSdkAdapter.prototype.sendUserMessage = originalSendUserMessage;
        OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
        OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
        OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      }
    });
  });

  test("uses latest runs after args update when starting build sessions", async () => {
    await withSuppressedRendererWarning(async () => {
      let buildStartCalls = 0;
      let startWorkingDirectory = "";

      const originalAgentSessionsList = host.agentSessionsList;
      const originalAgentSessionUpsert = host.agentSessionUpsert;
      const originalSpecGet = host.specGet;
      const originalPlanGet = host.planGet;
      const originalQaGetReport = host.qaGetReport;
      const originalBuildStart = host.buildStart;
      const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;

      const originalStartSession = OpencodeSdkAdapter.prototype.startSession;
      const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;

      host.agentSessionsList = async () => [];
      host.agentSessionUpsert = async () => {};
      host.specGet = async () => ({ markdown: "", updatedAt: null });
      host.planGet = async () => ({ markdown: "", updatedAt: null });
      host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
      host.buildStart = async () => {
        buildStartCalls += 1;
        return buildBootstrapFixture;
      };
      host.workspaceGetRepoConfig = async () => ({
        workspaceId: "repo",
        workspaceName: "Repo",
        repoPath: "/tmp/repo",
        defaultRuntimeKind: "opencode" as const,
        branchPrefix: "obp",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: {
          providers: {},
        },
        hooks: {
          preStart: [],
          postComplete: [],
        },
        devServers: [],
        worktreeCopyPaths: [],
        promptOverrides: {},
        agentDefaults: {},
      });

      OpencodeSdkAdapter.prototype.startSession = async (input) => {
        startWorkingDirectory = input.workingDirectory;
        return {
          runtimeKind: "opencode",
          externalSessionId: "external-updated-runs",
          startedAt: "2026-02-22T08:00:00.000Z",
          role: "build",
          scenario: "build_implementation_start",
          status: "idle",
        };
      };
      OpencodeSdkAdapter.prototype.subscribeEvents = (_externalSessionId, _listener) => () => {};
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixture],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();

        await harness.run(async () => {
          await harness.getLatest().startAgentSession({
            taskId: "task-1",
            role: "build",
            startMode: "fresh",
            selectedModel: BUILD_SELECTION,
          });
        });

        expect(buildStartCalls).toBe(0);
        expect(startWorkingDirectory).toBe(buildBootstrapFixture.workingDirectory);
      } finally {
        await harness.unmount();

        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.specGet = originalSpecGet;
        host.planGet = originalPlanGet;
        host.qaGetReport = originalQaGetReport;
        host.buildStart = originalBuildStart;
        host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;

        OpencodeSdkAdapter.prototype.startSession = originalStartSession;
        OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
        OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
        OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      }
    });
  });

  test("uses latest tasks after args update when validating send permissions", async () => {
    await withSuppressedRendererWarning(async () => {
      let sendCalls = 0;

      const originalAgentSessionsList = host.agentSessionsList;
      const originalAgentSessionUpsert = host.agentSessionUpsert;
      const originalSpecGet = host.specGet;
      const originalPlanGet = host.planGet;
      const originalQaGetReport = host.qaGetReport;

      const originalHasSession = OpencodeSdkAdapter.prototype.hasSession;
      const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
      const originalSendUserMessage = OpencodeSdkAdapter.prototype.sendUserMessage;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
      const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

      host.agentSessionsList = async () => [persistedSessionFixture];
      host.agentSessionUpsert = async () => {};
      host.specGet = async () => ({ markdown: "", updatedAt: null });
      host.planGet = async () => ({ markdown: "", updatedAt: null });
      host.qaGetReport = async () => ({ markdown: "", updatedAt: null });

      OpencodeSdkAdapter.prototype.hasSession = () => true;
      OpencodeSdkAdapter.prototype.subscribeEvents = () => () => {};
      OpencodeSdkAdapter.prototype.sendUserMessage = async () => {
        sendCalls += 1;
      };
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
      OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixture],
        refreshTaskData: async () => {},
      });

      const unavailableTask: TaskCard = {
        ...taskFixture,
        status: "open",
        agentWorkflows: {
          spec: { required: true, canSkip: false, available: true, completed: false },
          planner: { required: true, canSkip: false, available: false, completed: false },
          builder: { required: true, canSkip: false, available: false, completed: false },
          qa: { required: true, canSkip: false, available: false, completed: false },
        },
      };

      try {
        await harness.mount();

        await harness.run(async () => {
          await harness.getLatest().loadAgentSessions("task-1");
        });
        await harness.updateArgs({ tasks: [unavailableTask] });

        await harness.run(async () => {
          await expect(
            harness.getLatest().sendAgentMessage("external-1", [{ kind: "text", text: "hello" }]),
          ).rejects.toThrow("Role 'build' is unavailable for task 'task-1' in status 'open'.");
        });

        expect(sendCalls).toBe(0);
      } finally {
        await harness.unmount();

        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.specGet = originalSpecGet;
        host.planGet = originalPlanGet;
        host.qaGetReport = originalQaGetReport;

        OpencodeSdkAdapter.prototype.hasSession = originalHasSession;
        OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
        OpencodeSdkAdapter.prototype.sendUserMessage = originalSendUserMessage;
        OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
        OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
        OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      }
    });
  });

  test("reuses freshly loaded sessions without starting a new session", async () => {
    await withSuppressedRendererWarning(async () => {
      let startCalls = 0;

      const originalAgentSessionsList = host.agentSessionsList;
      const originalAgentSessionUpsert = host.agentSessionUpsert;
      const originalSpecGet = host.specGet;
      const originalPlanGet = host.planGet;
      const originalQaGetReport = host.qaGetReport;
      const originalBuildContinuationTargetGet = host.taskWorktreeGet;

      const originalStartSession = OpencodeSdkAdapter.prototype.startSession;
      const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;

      host.agentSessionsList = async () => [
        {
          ...persistedSessionFixture,
          role: "build",
          scenario: "build_after_human_request_changes",
          workingDirectory: "/tmp/repo/worktree",
        },
      ];
      host.agentSessionUpsert = async () => {};
      host.specGet = async () => ({ markdown: "", updatedAt: null });
      host.planGet = async () => ({ markdown: "", updatedAt: null });
      host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
      host.taskWorktreeGet = async () => ({
        workingDirectory: "/tmp/repo/worktree",
        source: "active_build_run",
      });

      OpencodeSdkAdapter.prototype.startSession = async () => {
        startCalls += 1;
        return {
          runtimeKind: "opencode",
          externalSessionId: "external-unexpected",
          startedAt: "2026-02-22T08:00:00.000Z",
          role: "build",
          scenario: "build_after_human_request_changes",
          status: "idle",
        };
      };
      OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [
          {
            ...taskFixture,
            agentSessions: [
              {
                ...persistedSessionFixture,
                role: "build",
                scenario: "build_after_human_request_changes",
                workingDirectory: "/tmp/repo/worktree",
              },
            ],
          },
        ],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();

        await harness.run(async () => {
          await harness.getLatest().loadAgentSessions("task-1");
        });
        await harness.waitFor((state) =>
          state.sessions.some((entry) => entry.externalSessionId === "external-1"),
        );

        let reusedSessionId = "";
        await harness.run(async () => {
          reusedSessionId = await harness.getLatest().startAgentSession({
            taskId: "task-1",
            role: "build",
            scenario: "build_after_human_request_changes",
            startMode: "reuse",
            sourceExternalSessionId: "external-1",
          });
        });

        expect(reusedSessionId).toBe("external-1");
        expect(startCalls).toBe(0);
      } finally {
        await harness.unmount();

        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.specGet = originalSpecGet;
        host.planGet = originalPlanGet;
        host.qaGetReport = originalQaGetReport;
        host.taskWorktreeGet = originalBuildContinuationTargetGet;

        OpencodeSdkAdapter.prototype.startSession = originalStartSession;
        OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
        OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
        OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      }
    });
  });

  test("removeAgentSessions prunes only matching task roles from local state", async () => {
    await withSuppressedRendererWarning(async () => {
      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixture],
        refreshTaskData: async () => {},
      });
      const originalAgentSessionsList = host.agentSessionsList;
      host.agentSessionsList = async () => [
        persistedSessionFixture,
        {
          ...persistedSessionFixture,
          externalSessionId: "external-spec",
          role: "spec",
          scenario: "spec_initial",
        },
      ];

      try {
        await harness.mount();
        await harness.run(async () => {
          await harness.getLatest().loadAgentSessions("task-1");
        });

        expect(
          harness
            .getLatest()
            .sessions.map((session) => session.externalSessionId)
            .sort(),
        ).toEqual(["external-1", "external-spec"]);

        await harness.run(async () => {
          harness.getLatest().removeAgentSessions({ taskId: "task-1", roles: ["build"] });
        });

        expect(harness.getLatest().sessions.map((session) => session.externalSessionId)).toEqual([
          "external-spec",
        ]);
      } finally {
        host.agentSessionsList = originalAgentSessionsList;
        await harness.unmount();
      }
    });
  });

  test("removeAgentSession detaches transcript-purpose attached sessions before local cleanup", async () => {
    await withSuppressedRendererWarning(async () => {
      const originalHasSession = OpencodeSdkAdapter.prototype.hasSession;
      const originalDetachSession = OpencodeSdkAdapter.prototype.detachSession;
      const detachCalls: string[] = [];

      OpencodeSdkAdapter.prototype.hasSession = (externalSessionId) =>
        externalSessionId === "external-transcript";
      OpencodeSdkAdapter.prototype.detachSession = async (externalSessionId) => {
        detachCalls.push(externalSessionId);
      };

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixture],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        await harness.run(async () => {
          harness.getLatest().commitSessions({
            "external-transcript": {
              externalSessionId: "external-transcript",
              taskId: "task-1",
              repoPath: "/tmp/repo",
              runtimeKind: "opencode",
              role: null,
              scenario: null,
              status: "idle",
              startedAt: "2026-02-22T08:00:00.000Z",
              runtimeId: null,
              workingDirectory: "/tmp/repo/worktree",
              historyHydrationState: "hydrated",
              runtimeRecoveryState: "idle",
              purpose: "transcript",
              messages: createSessionMessagesState("external-transcript", []),
              draftAssistantText: "",
              draftAssistantMessageId: null,
              draftReasoningText: "",
              draftReasoningMessageId: null,
              contextUsage: null,
              pendingPermissions: [],
              pendingQuestions: [],
              todos: [],
              modelCatalog: null,
              selectedModel: null,
              isLoadingModelCatalog: false,
              promptOverrides: {},
            },
          });
        });

        await harness.run(async () => {
          await harness.getLatest().removeAgentSession("external-transcript");
        });

        expect(detachCalls).toEqual(["external-transcript"]);
        expect(
          harness.getLatest().sessionStore.getSessionSnapshot("external-transcript"),
        ).toBeNull();
      } finally {
        await harness.unmount();
        OpencodeSdkAdapter.prototype.hasSession = originalHasSession;
        OpencodeSdkAdapter.prototype.detachSession = originalDetachSession;
      }
    });
  });

  test("removeAgentSessions detaches transcript-purpose attached sessions before task cleanup", async () => {
    await withSuppressedRendererWarning(async () => {
      const originalHasSession = OpencodeSdkAdapter.prototype.hasSession;
      const originalDetachSession = OpencodeSdkAdapter.prototype.detachSession;
      const detachCalls: string[] = [];

      OpencodeSdkAdapter.prototype.hasSession = (externalSessionId) =>
        externalSessionId.startsWith("external-transcript");
      OpencodeSdkAdapter.prototype.detachSession = async (externalSessionId) => {
        detachCalls.push(externalSessionId);
      };

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixture],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        await harness.run(async () => {
          harness.getLatest().commitSessions({
            "external-transcript-a": {
              externalSessionId: "external-transcript-a",
              taskId: "task-1",
              repoPath: "/tmp/repo",
              runtimeKind: "opencode",
              role: null,
              scenario: null,
              status: "idle",
              startedAt: "2026-02-22T08:00:00.000Z",
              runtimeId: null,
              workingDirectory: "/tmp/repo/worktree",
              historyHydrationState: "hydrated",
              runtimeRecoveryState: "idle",
              purpose: "transcript",
              messages: createSessionMessagesState("external-transcript-a", []),
              draftAssistantText: "",
              draftAssistantMessageId: null,
              draftReasoningText: "",
              draftReasoningMessageId: null,
              contextUsage: null,
              pendingPermissions: [],
              pendingQuestions: [],
              todos: [],
              modelCatalog: null,
              selectedModel: null,
              isLoadingModelCatalog: false,
              promptOverrides: {},
            },
            "external-transcript-b": {
              externalSessionId: "external-transcript-b",
              taskId: "task-1",
              repoPath: "/tmp/repo",
              runtimeKind: "opencode",
              role: null,
              scenario: null,
              status: "idle",
              startedAt: "2026-02-22T08:00:00.000Z",
              runtimeId: null,
              workingDirectory: "/tmp/repo/worktree",
              historyHydrationState: "hydrated",
              runtimeRecoveryState: "idle",
              purpose: "transcript",
              messages: createSessionMessagesState("external-transcript-b", []),
              draftAssistantText: "",
              draftAssistantMessageId: null,
              draftReasoningText: "",
              draftReasoningMessageId: null,
              contextUsage: null,
              pendingPermissions: [],
              pendingQuestions: [],
              todos: [],
              modelCatalog: null,
              selectedModel: null,
              isLoadingModelCatalog: false,
              promptOverrides: {},
            },
          });
        });

        await harness.run(async () => {
          await harness.getLatest().removeAgentSessions({ taskId: "task-1" });
        });

        expect(detachCalls.sort()).toEqual(["external-transcript-a", "external-transcript-b"]);
        expect(harness.getLatest().sessions).toEqual([]);
      } finally {
        await harness.unmount();
        OpencodeSdkAdapter.prototype.hasSession = originalHasSession;
        OpencodeSdkAdapter.prototype.detachSession = originalDetachSession;
      }
    });
  });

  test("revisit to the same repo bootstraps task sessions again", async () => {
    await withSuppressedRendererWarning(async () => {
      const originalAgentSessionsList = host.agentSessionsList;
      const originalRuntimeList = host.runtimeList;
      let persistedListCalls = 0;
      host.agentSessionsList = async () => {
        persistedListCalls += 1;
        return [persistedBuildSessionFixture];
      };
      host.runtimeList = async () => [createWorktreeRuntimeFixture()];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo-a",
        tasks: [taskFixtureWithPersistedBuildSession],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        await harness.updateArgs({
          activeRepo: null,
          tasks: [],
        });
        await harness.updateArgs({
          activeRepo: "/tmp/repo-a",
          tasks: [taskFixtureWithPersistedBuildSession],
        });
        const hydrated = await harness.waitFor((state) => state.sessions.length === 1);
        expect(hydrated.sessions[0]?.externalSessionId).toBe("external-1");
        expect(persistedListCalls).toBe(0);
      } finally {
        await harness.unmount();
        host.agentSessionsList = originalAgentSessionsList;
        host.runtimeList = originalRuntimeList;
      }
    });
  });

  test("reconciles live agent sessions even when persisted records omit status", async () => {
    await withSuppressedRendererWarning(async () => {
      const originalAgentSessionsList = host.agentSessionsList;
      const originalAgentSessionUpsert = host.agentSessionUpsert;
      const originalSpecGet = host.specGet;
      const originalPlanGet = host.planGet;
      const originalQaGetReport = host.qaGetReport;
      const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
      const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

      host.agentSessionsList = async () => [persistedBuildSessionFixture];
      host.agentSessionUpsert = async () => {};
      host.specGet = async () => ({ markdown: "", updatedAt: null });
      host.planGet = async () => ({ markdown: "", updatedAt: null });
      host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
      host.runtimeList = async () => [
        {
          kind: "opencode",
          runtimeId: "runtime-1",
          repoPath: "/tmp/repo",
          taskId: null,
          role: "workspace",
          workingDirectory: "/tmp/repo/worktree",
          runtimeRoute: {
            type: "local_http" as const,
            endpoint: "http://127.0.0.1:4444",
          },
          startedAt: "2026-02-22T08:00:00.000Z",
          descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        },
      ];
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots = async () => [
        {
          externalSessionId: "external-1",
          title: "BUILD task-1",
          workingDirectory: "/tmp/repo/worktree",
          startedAt: "2026-02-22T08:00:00.000Z",
          status: { type: "busy" },
          pendingPermissions: [],
          pendingQuestions: [],
        },
      ];
      OpencodeSdkAdapter.prototype.resumeSession = async (input) => ({
        runtimeKind: input.runtimeKind,
        externalSessionId: input.externalSessionId,
        startedAt: "2026-02-22T08:00:00.000Z",
        role: input.role,
        scenario: input.scenario,
        status: "running",
      });
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
      OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixtureWithPersistedBuildSession],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        const resolved = await harness.waitFor((state) =>
          state.sessions.some(
            (session) => session.externalSessionId === "external-1" && session.status === "running",
          ),
        );
        expect(
          resolved.sessions.find((session) => session.externalSessionId === "external-1")?.status,
        ).toBe("running");
      } finally {
        await harness.unmount();
        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.specGet = originalSpecGet;
        host.planGet = originalPlanGet;
        host.qaGetReport = originalQaGetReport;
        OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
        OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
        OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
        OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      }
    });
  });

  test("does not resume idle live agent sessions on repo bootstrap", async () => {
    await withSuppressedRendererWarning(async () => {
      const originalAgentSessionsList = host.agentSessionsList;
      const originalAgentSessionUpsert = host.agentSessionUpsert;
      const originalSpecGet = host.specGet;
      const originalPlanGet = host.planGet;
      const originalQaGetReport = host.qaGetReport;
      const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
      const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
      let liveSnapshotScans = 0;
      let resumeCalls = 0;

      host.agentSessionsList = async () => [persistedBuildSessionFixture];
      host.agentSessionUpsert = async () => {};
      host.specGet = async () => ({ markdown: "", updatedAt: null });
      host.planGet = async () => ({ markdown: "", updatedAt: null });
      host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
      host.runtimeList = async () => [
        {
          kind: "opencode",
          runtimeId: "runtime-1",
          repoPath: "/tmp/repo",
          taskId: null,
          role: "workspace",
          workingDirectory: "/tmp/repo/worktree",
          runtimeRoute: {
            type: "local_http" as const,
            endpoint: "http://127.0.0.1:4444",
          },
          startedAt: "2026-02-22T08:00:00.000Z",
          descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        },
      ];
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots = async () => {
        liveSnapshotScans += 1;
        return [
          {
            externalSessionId: "external-1",
            title: "BUILD task-1",
            workingDirectory: "/tmp/repo/worktree",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "idle" },
            pendingPermissions: [],
            pendingQuestions: [],
          },
        ];
      };
      OpencodeSdkAdapter.prototype.resumeSession = async (input) => {
        resumeCalls += 1;
        return {
          runtimeKind: input.runtimeKind,
          externalSessionId: input.externalSessionId,
          startedAt: "2026-02-22T08:00:00.000Z",
          role: input.role,
          scenario: input.scenario,
          status: "idle",
        };
      };
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
      OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixtureWithPersistedBuildSession],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        await harness.waitFor(() => liveSnapshotScans > 0);
        expect(resumeCalls).toBe(0);
      } finally {
        await harness.unmount();
        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.specGet = originalSpecGet;
        host.planGet = originalPlanGet;
        host.qaGetReport = originalQaGetReport;
        OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
        OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
        OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
        OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      }
    });
  });

  test("tracks explicit runtime recovery state while reattaching a restored session runtime", async () => {
    const originalRuntimeList = host.runtimeList;
    const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
    const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
    const originalListLiveAgentSessionSnapshots =
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

    host.runtimeList = async () => [];
    OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots = async () => [];
    let attachCalls = 0;
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [
      {
        messageId: "history-1",
        role: "assistant",
        timestamp: "2026-02-22T08:00:01.000Z",
        text: "Recovered history",
        parts: [
          {
            kind: "text",
            messageId: "history-1",
            partId: "part-1",
            text: "Recovered history",
            completed: true,
          },
        ],
      },
    ];
    OpencodeSdkAdapter.prototype.resumeSession = async (input) => {
      return {
        runtimeKind: input.runtimeKind,
        externalSessionId: input.externalSessionId,
        startedAt: "2026-02-22T08:00:00.000Z",
        role: input.role,
        scenario: input.scenario,
        status: "running",
      };
    };
    OpencodeSdkAdapter.prototype.attachSession = async (input) => {
      attachCalls += 1;
      return {
        runtimeKind: input.runtimeKind,
        externalSessionId: input.externalSessionId,
        startedAt: "2026-02-22T08:00:00.000Z",
        role: input.role,
        scenario: input.scenario,
        status: "running",
      };
    };

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        await harness.getLatest().loadAgentSessions("task-1", {
          persistedRecords: [persistedBuildSessionFixture],
        });
      });

      expect(
        harness.getLatest().sessionStore.getSessionSnapshot("external-1")?.runtimeRecoveryState,
      ).toBe("idle");

      host.runtimeList = async () => [];
      await clearAppQueryClient();

      await expect(
        harness.run(async () => {
          await harness.getLatest().retrySessionRuntimeAttachment({
            taskId: "task-1",
            externalSessionId: "external-1",
            persistedRecords: [persistedBuildSessionFixture],
          });
        }),
      ).rejects.toThrow("No live repo runtime found");

      expect(
        harness.getLatest().sessionStore.getSessionSnapshot("external-1")?.runtimeRecoveryState,
      ).toBe("failed");

      host.runtimeList = async () => [
        {
          kind: "opencode",
          runtimeId: "runtime-1",
          repoPath: "/tmp/repo",
          taskId: null,
          role: "workspace",
          workingDirectory: "/tmp/repo/worktree",
          runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
          startedAt: "2026-02-22T08:00:00.000Z",
          descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        },
      ];
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots = async () => [
        {
          externalSessionId: "external-1",
          title: "BUILD task-1",
          workingDirectory: "/tmp/repo/worktree",
          startedAt: "2026-02-22T08:00:00.000Z",
          status: { type: "busy" },
          pendingPermissions: [],
          pendingQuestions: [],
        },
      ];
      await clearAppQueryClient();
      attachCalls = 0;

      await harness.run(async () => {
        await harness.getLatest().retrySessionRuntimeAttachment({
          taskId: "task-1",
          externalSessionId: "external-1",
          persistedRecords: [persistedBuildSessionFixture],
        });
      });

      const recoveredSession = harness.getLatest().sessionStore.getSessionSnapshot("external-1");
      expect(attachCalls).toBe(1);
      expect(recoveredSession?.runtimeRecoveryState).toBe("idle");
      expect(recoveredSession?.historyHydrationState).toBe("hydrated");
      expect(
        recoveredSession
          ? sessionMessagesToArray(recoveredSession).some(
              (message) => message.content === "Recovered history",
            )
          : false,
      ).toBe(true);
    } finally {
      await harness.unmount();
      host.runtimeList = originalRuntimeList;
      OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
      OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots =
        originalListLiveAgentSessionSnapshots;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("starts requested history hydration inside the recovery operation once runtime recovery succeeds", async () => {
    const originalRuntimeList = host.runtimeList;
    const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
    const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
    const originalListLiveAgentSessionSnapshots =
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

    let loadSessionHistoryCalls = 0;

    host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo/worktree",
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];
    OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots = async () => [
      {
        externalSessionId: "external-1",
        title: "BUILD task-1",
        workingDirectory: "/tmp/repo/worktree",
        startedAt: "2026-02-22T08:00:00.000Z",
        status: { type: "busy" },
        pendingPermissions: [],
        pendingQuestions: [],
      },
    ];
    OpencodeSdkAdapter.prototype.resumeSession = async (input) => ({
      runtimeKind: input.runtimeKind,
      externalSessionId: input.externalSessionId,
      startedAt: "2026-02-22T08:00:00.000Z",
      role: input.role,
      scenario: input.scenario,
      status: "running",
    });
    OpencodeSdkAdapter.prototype.attachSession = async (input) => ({
      runtimeKind: input.runtimeKind,
      externalSessionId: input.externalSessionId,
      startedAt: "2026-02-22T08:00:00.000Z",
      role: input.role,
      scenario: input.scenario,
      status: "running",
    });
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => {
      loadSessionHistoryCalls += 1;
      return [
        {
          messageId: "history-1",
          role: "assistant",
          timestamp: "2026-02-22T08:00:01.000Z",
          text: "Recovered history",
          parts: [
            {
              kind: "text",
              messageId: "history-1",
              partId: "part-1",
              text: "Recovered history",
              completed: true,
            },
          ],
        },
      ];
    };

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        await harness.getLatest().loadAgentSessions("task-1", {
          persistedRecords: [persistedBuildSessionFixture],
        });
      });
      await clearAppQueryClient();

      await harness.run(async () => {
        await harness.getLatest().retrySessionRuntimeAttachment({
          taskId: "task-1",
          externalSessionId: "external-1",
          persistedRecords: [persistedBuildSessionFixture],
        });
      });

      expect(loadSessionHistoryCalls).toBe(1);
      expect(
        harness.getLatest().sessionStore.getSessionSnapshot("external-1")?.historyHydrationState,
      ).toBe("hydrated");
    } finally {
      await harness.unmount();
      host.runtimeList = originalRuntimeList;
      OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
      OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots =
        originalListLiveAgentSessionSnapshots;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("retries runtime transcript attachment after an attach failure clears the dedupe gate", async () => {
    const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
    const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
    const originalHasSession = OpencodeSdkAdapter.prototype.hasSession;
    const originalDetachSession = OpencodeSdkAdapter.prototype.detachSession;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const attachSessionCalls: Parameters<OpencodeSdkAdapter["attachSession"]>[0][] = [];
    let loadSessionHistoryCalls = 0;

    host.agentSessionUpsert = async () => {};
    OpencodeSdkAdapter.prototype.hasSession = () => false;
    OpencodeSdkAdapter.prototype.attachSession = async (input) => {
      attachSessionCalls.push(input);

      if (attachSessionCalls.length === 1) {
        throw new Error("attach unavailable");
      }

      return {
        runtimeKind: input.runtimeKind,
        externalSessionId: input.externalSessionId,
        startedAt: "2026-02-22T09:00:00.000Z",
        role: input.role,
        scenario: input.scenario,
        status: "running",
      };
    };
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => {
      loadSessionHistoryCalls += 1;
      return [
        {
          messageId: "history-subagent-1",
          role: "assistant",
          timestamp: "2026-02-22T09:00:01.000Z",
          text: "Subagent output",
          parts: [
            {
              kind: "text",
              messageId: "history-subagent-1",
              partId: "part-1",
              text: "Subagent output",
              completed: true,
            },
          ],
        },
      ];
    };
    OpencodeSdkAdapter.prototype.subscribeEvents = () => () => {};
    OpencodeSdkAdapter.prototype.detachSession = async () => {};

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();

      await expect(
        harness.run(async () => {
          await harness.getLatest().operations.attachRuntimeTranscriptSession({
            repoPath: "/tmp/repo",
            externalSessionId: "external-subagent",
            runtimeKind: "opencode",
            runtimeId: "runtime-1",
            workingDirectory: "/tmp/repo/worktree",
          });
        }),
      ).rejects.toThrow("attach unavailable");

      expect(attachSessionCalls).toHaveLength(1);

      await harness.run(async () => {
        await harness.getLatest().operations.attachRuntimeTranscriptSession({
          repoPath: "/tmp/repo",
          externalSessionId: "external-subagent",
          runtimeKind: "opencode",
          runtimeId: "runtime-1",
          workingDirectory: "/tmp/repo/worktree",
        });
      });

      expect(attachSessionCalls).toHaveLength(2);
      expect(loadSessionHistoryCalls).toBe(1);
    } finally {
      await harness.unmount();
      OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
      OpencodeSdkAdapter.prototype.hasSession = originalHasSession;
      OpencodeSdkAdapter.prototype.detachSession = originalDetachSession;
      host.agentSessionUpsert = originalAgentSessionUpsert;
    }
  });

  test("attaches runtime transcript sessions to existing live events without persisted prompt metadata", async () => {
    const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
    const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
    const originalHasSession = OpencodeSdkAdapter.prototype.hasSession;
    const originalDetachSession = OpencodeSdkAdapter.prototype.detachSession;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const attachSessionCalls: Parameters<OpencodeSdkAdapter["attachSession"]>[0][] = [];
    const subscribeExternalSessionIds: string[] = [];
    const operationOrder: string[] = [];
    const attachSessionDeferred =
      createDeferred<Awaited<ReturnType<OpencodeSdkAdapter["attachSession"]>>>();
    const agentSessionUpsert = mock(async () => {});
    let attachedSessionId: string | null = null;
    const listeners: Array<Parameters<OpencodeSdkAdapter["subscribeEvents"]>[1]> = [];

    host.agentSessionUpsert = agentSessionUpsert;
    OpencodeSdkAdapter.prototype.hasSession = (externalSessionId) =>
      externalSessionId === attachedSessionId;
    OpencodeSdkAdapter.prototype.attachSession = async (input) => {
      operationOrder.push("attach:start");
      attachSessionCalls.push(input);
      attachedSessionId = input.externalSessionId;
      const summary = await attachSessionDeferred.promise;
      operationOrder.push("attach:finish");
      return summary;
    };
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [
      {
        messageId: "history-subagent-1",
        role: "assistant",
        timestamp: "2026-02-22T09:00:01.000Z",
        text: "Subagent output",
        parts: [
          {
            kind: "text",
            messageId: "history-subagent-1",
            partId: "part-1",
            text: "Subagent output",
            completed: true,
          },
        ],
      },
    ];
    OpencodeSdkAdapter.prototype.subscribeEvents = (externalSessionId, nextListener) => {
      operationOrder.push("subscribe");
      if (!attachedSessionId) {
        throw new Error("subscribe before attach");
      }
      subscribeExternalSessionIds.push(externalSessionId);
      listeners.push(nextListener);
      return () => {};
    };
    OpencodeSdkAdapter.prototype.detachSession = async () => {};

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      let attachPromise: Promise<void> | null = null;
      await harness.run(async () => {
        attachPromise = harness.getLatest().operations.attachRuntimeTranscriptSession({
          repoPath: "/tmp/repo",
          externalSessionId: "external-subagent",
          runtimeKind: "opencode",
          runtimeId: "runtime-1",
          workingDirectory: "/tmp/repo/worktree",
        });
        await Promise.resolve();
      });

      expect(operationOrder).toEqual(["attach:start", "subscribe"]);
      attachSessionDeferred.resolve({
        runtimeKind: "opencode",
        externalSessionId: "external-subagent",
        startedAt: "2026-02-22T09:00:00.000Z",
        role: "build",
        scenario: "build_implementation_start",
        status: "running",
      });
      await harness.run(async () => {
        await attachPromise;
      });

      expect(operationOrder).toEqual(["attach:start", "subscribe", "attach:finish"]);
      expect(subscribeExternalSessionIds).toEqual(["external-subagent"]);
      expect(attachSessionCalls).toHaveLength(1);
      expect(attachSessionCalls[0]).toMatchObject({
        externalSessionId: "external-subagent",
        purpose: "transcript",
        taskId: "",
        role: null,
        scenario: null,
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
        systemPrompt: "",
      });

      const transcriptSession = harness
        .getLatest()
        .sessionStore.getSessionSnapshot("external-subagent");
      expect(transcriptSession?.purpose).toBe("transcript");
      expect(transcriptSession?.taskId).toBe("");
      expect(transcriptSession?.role).toBeNull();
      expect(transcriptSession?.scenario).toBeNull();
      expect(transcriptSession?.status).toBe("running");
      expect(
        transcriptSession
          ? sessionMessagesToArray(transcriptSession).some(
              (message) => message.content === "Subagent output",
            )
          : false,
      ).toBe(true);

      const listener = listeners[0];
      if (!listener) {
        throw new Error("Expected transcript listener to be attached");
      }
      listener({
        type: "permission_required",
        externalSessionId: "external-subagent",
        timestamp: "2026-02-22T09:00:02.000Z",
        requestId: "permission-1",
        permission: "file.read",
        patterns: ["src/app.ts"],
      });
      expect(agentSessionUpsert).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      host.agentSessionUpsert = originalAgentSessionUpsert;
      OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
      OpencodeSdkAdapter.prototype.hasSession = originalHasSession;
      OpencodeSdkAdapter.prototype.detachSession = originalDetachSession;
    }
  });

  test("replaces stale local transcript state before attaching a new runtime transcript", async () => {
    const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
    const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
    const originalHasSession = OpencodeSdkAdapter.prototype.hasSession;
    const originalDetachSession = OpencodeSdkAdapter.prototype.detachSession;
    const attachSessionCalls: Parameters<OpencodeSdkAdapter["attachSession"]>[0][] = [];
    const subscribedExternalSessionIds: string[] = [];

    OpencodeSdkAdapter.prototype.hasSession = () => false;
    OpencodeSdkAdapter.prototype.attachSession = async (input) => {
      attachSessionCalls.push(input);
      return {
        runtimeKind: input.runtimeKind,
        externalSessionId: input.externalSessionId,
        startedAt: "2026-02-22T09:00:00.000Z",
        role: input.role,
        scenario: input.scenario,
        status: "running",
      };
    };
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [
      {
        messageId: "history-new-subagent",
        role: "assistant",
        timestamp: "2026-02-22T09:00:01.000Z",
        text: "New subagent output",
        parts: [
          {
            kind: "text",
            messageId: "history-new-subagent",
            partId: "part-1",
            text: "New subagent output",
            completed: true,
          },
        ],
      },
    ];
    OpencodeSdkAdapter.prototype.subscribeEvents = (externalSessionId) => {
      subscribedExternalSessionIds.push(externalSessionId);
      return () => {};
    };
    OpencodeSdkAdapter.prototype.detachSession = async () => {
      throw new Error("stale local transcript replacement should not detach runtime sessions");
    };

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        harness.getLatest().commitSessions({
          "external-subagent": {
            externalSessionId: "stale-external-subagent",
            taskId: "",
            repoPath: "/tmp/repo",
            runtimeKind: "opencode",
            role: null,
            scenario: null,
            status: "idle",
            startedAt: "2026-02-22T08:00:00.000Z",
            runtimeId: "stale-runtime",
            workingDirectory: "/tmp/repo/old-worktree",
            historyHydrationState: "hydrated",
            runtimeRecoveryState: "idle",
            purpose: "transcript",
            messages: createSessionMessagesState("external-subagent", []),
            draftAssistantText: "",
            draftAssistantMessageId: null,
            draftReasoningText: "",
            draftReasoningMessageId: null,
            contextUsage: null,
            pendingPermissions: [],
            pendingQuestions: [],
            todos: [],
            modelCatalog: null,
            selectedModel: null,
            isLoadingModelCatalog: false,
            promptOverrides: {},
          },
        });
      });

      await harness.run(async () => {
        await harness.getLatest().operations.attachRuntimeTranscriptSession({
          repoPath: "/tmp/repo",
          externalSessionId: "external-subagent",
          runtimeKind: "opencode",
          runtimeId: "runtime-1",
          workingDirectory: "/tmp/repo/worktree",
        });
      });

      expect(attachSessionCalls).toHaveLength(1);
      expect(subscribedExternalSessionIds).toEqual(["external-subagent"]);

      const transcriptSession = harness
        .getLatest()
        .sessionStore.getSessionSnapshot("external-subagent");
      expect(transcriptSession).toMatchObject({
        purpose: "transcript",
        externalSessionId: "external-subagent",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
        status: "running",
      });
      expect(
        transcriptSession
          ? sessionMessagesToArray(transcriptSession).some(
              (message) => message.content === "New subagent output",
            )
          : false,
      ).toBe(true);
    } finally {
      await harness.unmount();
      OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
      OpencodeSdkAdapter.prototype.hasSession = originalHasSession;
      OpencodeSdkAdapter.prototype.detachSession = originalDetachSession;
    }
  });

  test("detaches an in-flight runtime transcript attach when the local transcript closes", async () => {
    const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
    const originalHasSession = OpencodeSdkAdapter.prototype.hasSession;
    const originalDetachSession = OpencodeSdkAdapter.prototype.detachSession;
    const attachSessionDeferred =
      createDeferred<Awaited<ReturnType<OpencodeSdkAdapter["attachSession"]>>>();
    const detachExternalSessionIds: string[] = [];
    let loadSessionHistoryCalls = 0;
    let runtimeAttached = false;

    OpencodeSdkAdapter.prototype.attachSession = async (input) => {
      runtimeAttached = true;
      const summary = await attachSessionDeferred.promise;
      runtimeAttached = true;
      return {
        ...summary,
        runtimeKind: input.runtimeKind,
      };
    };
    OpencodeSdkAdapter.prototype.hasSession = (externalSessionId) =>
      externalSessionId === "external-subagent" && runtimeAttached;
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => {
      loadSessionHistoryCalls += 1;
      return [];
    };
    OpencodeSdkAdapter.prototype.detachSession = async (externalSessionId) => {
      detachExternalSessionIds.push(externalSessionId);
      runtimeAttached = false;
    };

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      let attachPromise: Promise<void> | null = null;
      await harness.run(async () => {
        attachPromise = harness.getLatest().operations.attachRuntimeTranscriptSession({
          repoPath: "/tmp/repo",
          externalSessionId: "external-subagent",
          runtimeKind: "opencode",
          runtimeId: "runtime-1",
          workingDirectory: "/tmp/repo/worktree",
        });
        await Promise.resolve();
      });

      expect(
        harness.getLatest().sessionStore.getSessionSnapshot("external-subagent"),
      ).not.toBeNull();

      await harness.run(async () => {
        await harness.getLatest().operations.removeAgentSession("external-subagent");
      });

      expect(harness.getLatest().sessionStore.getSessionSnapshot("external-subagent")).toBeNull();

      attachSessionDeferred.resolve({
        runtimeKind: "opencode",
        externalSessionId: "external-subagent",
        startedAt: "2026-02-22T09:00:00.000Z",
        role: "build",
        scenario: "build_implementation_start",
        status: "running",
      });
      await harness.run(async () => {
        await attachPromise;
      });

      expect(loadSessionHistoryCalls).toBe(0);
      expect(detachExternalSessionIds).toEqual(["external-subagent", "external-subagent"]);
      expect(harness.getLatest().sessionStore.getSessionSnapshot("external-subagent")).toBeNull();
    } finally {
      await harness.unmount();
      OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      OpencodeSdkAdapter.prototype.hasSession = originalHasSession;
      OpencodeSdkAdapter.prototype.detachSession = originalDetachSession;
    }
  });

  test("retries requested history hydration after recovery when the prior hydration state failed", async () => {
    const originalRuntimeList = host.runtimeList;
    const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
    const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
    const originalListLiveAgentSessionSnapshots =
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

    let loadSessionHistoryCalls = 0;

    host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo/worktree",
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];
    OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots = async () => [
      {
        externalSessionId: "external-1",
        title: "BUILD task-1",
        workingDirectory: "/tmp/repo/worktree",
        startedAt: "2026-02-22T08:00:00.000Z",
        status: { type: "busy" },
        pendingPermissions: [],
        pendingQuestions: [],
      },
    ];
    OpencodeSdkAdapter.prototype.resumeSession = async (input) => ({
      runtimeKind: input.runtimeKind,
      externalSessionId: input.externalSessionId,
      startedAt: "2026-02-22T08:00:00.000Z",
      role: input.role,
      scenario: input.scenario,
      status: "running",
    });
    OpencodeSdkAdapter.prototype.attachSession = async (input) => ({
      runtimeKind: input.runtimeKind,
      externalSessionId: input.externalSessionId,
      startedAt: "2026-02-22T08:00:00.000Z",
      role: input.role,
      scenario: input.scenario,
      status: "running",
    });
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => {
      loadSessionHistoryCalls += 1;
      return [
        {
          messageId: "history-retry-1",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "Retried history",
          parts: [
            {
              kind: "text",
              messageId: "history-retry-1",
              partId: "part-1",
              text: "Retried history",
              completed: true,
            },
          ],
        },
      ];
    };
    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        await harness.getLatest().loadAgentSessions("task-1", {
          persistedRecords: [persistedBuildSessionFixture],
        });
      });
      const sessionsById = harness.getLatest().sessionStore.getSessionsByIdSnapshot();
      const failedSession = sessionsById["external-1"];
      if (!failedSession) {
        throw new Error("Expected session-1 to exist after bootstrapping persisted sessions");
      }
      harness.getLatest().sessionStore.setSessionsById({
        ...sessionsById,
        "external-1": {
          ...failedSession,
          historyHydrationState: "failed",
        },
      });
      await clearAppQueryClient();

      await harness.run(async () => {
        await harness.getLatest().retrySessionRuntimeAttachment({
          taskId: "task-1",
          externalSessionId: "external-1",
          persistedRecords: [persistedBuildSessionFixture],
        });
      });

      expect(loadSessionHistoryCalls).toBe(1);
      expect(
        harness.getLatest().sessionStore.getSessionSnapshot("external-1")?.historyHydrationState,
      ).toBe("hydrated");
    } finally {
      await harness.unmount();
      host.runtimeList = originalRuntimeList;
      OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
      OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots =
        originalListLiveAgentSessionSnapshots;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("keeps runtime recovery idle when history hydration fails after runtime recovery succeeds", async () => {
    const originalRuntimeList = host.runtimeList;
    const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
    const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
    const originalListLiveAgentSessionSnapshots =
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

    host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo/worktree",
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];
    OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots = async () => [
      {
        externalSessionId: "external-1",
        title: "BUILD task-1",
        workingDirectory: "/tmp/repo/worktree",
        startedAt: "2026-02-22T08:00:00.000Z",
        status: { type: "busy" },
        pendingPermissions: [],
        pendingQuestions: [],
      },
    ];
    OpencodeSdkAdapter.prototype.resumeSession = async (input) => ({
      runtimeKind: input.runtimeKind,
      externalSessionId: input.externalSessionId,
      startedAt: "2026-02-22T08:00:00.000Z",
      role: input.role,
      scenario: input.scenario,
      status: "running",
    });
    OpencodeSdkAdapter.prototype.attachSession = async (input) => ({
      runtimeKind: input.runtimeKind,
      externalSessionId: input.externalSessionId,
      startedAt: "2026-02-22T08:00:00.000Z",
      role: input.role,
      scenario: input.scenario,
      status: "running",
    });
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => {
      throw new Error("history unavailable");
    };

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        await harness.getLatest().loadAgentSessions("task-1", {
          persistedRecords: [persistedBuildSessionFixture],
        });
      });
      await clearAppQueryClient();

      await expect(
        harness.run(async () => {
          await harness.getLatest().retrySessionRuntimeAttachment({
            taskId: "task-1",
            externalSessionId: "external-1",
            persistedRecords: [persistedBuildSessionFixture],
          });
        }),
      ).rejects.toThrow("history unavailable");

      const recoveredSession = harness.getLatest().sessionStore.getSessionSnapshot("external-1");
      expect(recoveredSession?.runtimeRecoveryState).toBe("idle");
      expect(recoveredSession?.historyHydrationState).toBe("failed");
      expect(recoveredSession?.runtimeId).toBe("runtime-1");
    } finally {
      await harness.unmount();
      host.runtimeList = originalRuntimeList;
      OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
      OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots =
        originalListLiveAgentSessionSnapshots;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("requests history after recovery when the session already has a local transcript tail", async () => {
    const originalRuntimeList = host.runtimeList;
    const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
    const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
    const originalListLiveAgentSessionSnapshots =
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

    let loadSessionHistoryCalls = 0;

    host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo/worktree",
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];
    OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots = async () => [
      {
        externalSessionId: "external-1",
        title: "BUILD task-1",
        workingDirectory: "/tmp/repo/worktree",
        startedAt: "2026-02-22T08:00:00.000Z",
        status: { type: "busy" },
        pendingPermissions: [],
        pendingQuestions: [],
      },
    ];
    OpencodeSdkAdapter.prototype.resumeSession = async (input) => ({
      runtimeKind: input.runtimeKind,
      externalSessionId: input.externalSessionId,
      startedAt: "2026-02-22T08:00:00.000Z",
      role: input.role,
      scenario: input.scenario,
      status: "running",
    });
    OpencodeSdkAdapter.prototype.attachSession = async (input) => ({
      runtimeKind: input.runtimeKind,
      externalSessionId: input.externalSessionId,
      startedAt: "2026-02-22T08:00:00.000Z",
      role: input.role,
      scenario: input.scenario,
      status: "running",
    });
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => {
      loadSessionHistoryCalls += 1;
      return [
        {
          messageId: "history-tail-1",
          role: "assistant",
          timestamp: "2026-02-22T08:00:04.000Z",
          text: "Recovered history tail",
          parts: [
            {
              kind: "text",
              messageId: "history-tail-1",
              partId: "part-1",
              text: "Recovered history tail",
              completed: true,
            },
          ],
        },
      ];
    };

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        await harness.getLatest().loadAgentSessions("task-1", {
          persistedRecords: [persistedBuildSessionFixture],
        });
      });

      const sessionsById = harness.getLatest().sessionStore.getSessionsByIdSnapshot();
      const session = sessionsById["external-1"];
      if (!session) {
        throw new Error("Expected session-1 to exist after bootstrapping persisted sessions");
      }
      await harness.run(async () => {
        harness.getLatest().commitSessions({
          ...sessionsById,
          "external-1": {
            ...session,
            historyHydrationState: "failed",
            messages: createSessionMessagesState("external-1", [
              {
                id: "local-message-1",
                role: "assistant",
                content: "Local transcript still present",
                timestamp: "2026-02-22T08:00:03.000Z",
              },
            ]),
          },
        });
      });
      await clearAppQueryClient();

      await harness.run(async () => {
        await harness.getLatest().retrySessionRuntimeAttachment({
          taskId: "task-1",
          externalSessionId: "external-1",
          persistedRecords: [persistedBuildSessionFixture],
        });
      });

      expect(loadSessionHistoryCalls).toBe(1);
      const recoveredSession = harness.getLatest().sessionStore.getSessionSnapshot("external-1");
      expect(recoveredSession?.runtimeRecoveryState).toBe("idle");
      expect(recoveredSession?.historyHydrationState).toBe("hydrated");
      const recoveredContents = recoveredSession
        ? sessionMessagesToArray(recoveredSession).map((message) => message.content)
        : [];
      expect(recoveredContents).toEqual(
        expect.arrayContaining([
          "Recovered history tail",
          "Local transcript still present",
          expect.stringContaining("Session started (build - build_implementation_start)"),
          expect.stringContaining("System prompt:"),
        ]),
      );
    } finally {
      await harness.unmount();
      host.runtimeList = originalRuntimeList;
      OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
      OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots =
        originalListLiveAgentSessionSnapshots;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("scans each runtime endpoint only once during repo reconciliation", async () => {
    await withSuppressedRendererWarning(async () => {
      const originalAgentSessionsList = host.agentSessionsList;
      const originalAgentSessionUpsert = host.agentSessionUpsert;
      const originalSpecGet = host.specGet;
      const originalPlanGet = host.planGet;
      const originalQaGetReport = host.qaGetReport;
      const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
      const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

      let listLiveAgentSessionSnapshotsCalls = 0;
      const scannedEndpoints: string[] = [];

      host.agentSessionsList = async () => [persistedBuildSessionFixture];
      host.agentSessionUpsert = async () => {};
      host.specGet = async () => ({ markdown: "", updatedAt: null });
      host.planGet = async () => ({ markdown: "", updatedAt: null });
      host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
      host.runtimeList = async () =>
        [
          {
            kind: "opencode",
            runtimeId: "runtime-repo",
            repoPath: "/tmp/repo",
            taskId: null,
            role: "workspace",
            workingDirectory: "/tmp/repo",
            runtimeRoute: {
              type: "local_http" as const,
              endpoint: "http://127.0.0.1:4444",
            },
            startedAt: "2026-02-22T08:00:00.000Z",
            descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
          },
          {
            kind: "opencode",
            runtimeId: "runtime-build",
            repoPath: "/tmp/repo",
            taskId: "task-1",
            role: "build",
            workingDirectory: "/tmp/repo/worktree",
            runtimeRoute: {
              type: "local_http" as const,
              endpoint: "http://127.0.0.1:4444",
            },
            startedAt: "2026-02-22T08:00:00.000Z",
            descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
          },
        ] as Awaited<ReturnType<typeof host.runtimeList>>;
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots = async (input) => {
        listLiveAgentSessionSnapshotsCalls += 1;
        scannedEndpoints.push(
          `${input.repoPath}:${input.runtimeKind}:${input.directories?.join(",") ?? ""}`,
        );
        return [
          {
            externalSessionId: "external-1",
            title: "BUILD task-1",
            workingDirectory: "/tmp/repo/worktree",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
            pendingPermissions: [],
            pendingQuestions: [],
          },
        ];
      };
      OpencodeSdkAdapter.prototype.resumeSession = async (input) => ({
        runtimeKind: input.runtimeKind,
        externalSessionId: input.externalSessionId,
        startedAt: "2026-02-22T08:00:00.000Z",
        role: input.role,
        scenario: input.scenario,
        status: "running",
      });
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
      OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixtureWithPersistedBuildSession],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        await harness.waitFor((state) =>
          state.sessions.some(
            (session) => session.externalSessionId === "external-1" && session.status === "running",
          ),
        );
        expect(new Set(scannedEndpoints)).toEqual(
          new Set(["/tmp/repo:opencode:/tmp/repo/worktree"]),
        );
        expect(listLiveAgentSessionSnapshotsCalls).toBeLessThan(3);
      } finally {
        await harness.unmount();
        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.specGet = originalSpecGet;
        host.planGet = originalPlanGet;
        host.qaGetReport = originalQaGetReport;
        OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
        OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
        OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
        OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      }
    });
  });

  test("does not restart the same repo reconciliation while runtime session scan is still in flight", async () => {
    await withSuppressedRendererWarning(async () => {
      const originalAgentSessionsList = host.agentSessionsList;
      const originalAgentSessionUpsert = host.agentSessionUpsert;
      const originalSpecGet = host.specGet;
      const originalPlanGet = host.planGet;
      const originalQaGetReport = host.qaGetReport;
      const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
      const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
      const runtimeSessionsDeferred =
        createDeferred<Awaited<ReturnType<OpencodeSdkAdapter["listLiveAgentSessionSnapshots"]>>>();

      let listLiveAgentSessionSnapshotsCalls = 0;

      host.agentSessionsList = async () => [persistedBuildSessionFixture];
      host.agentSessionUpsert = async () => {};
      host.specGet = async () => ({ markdown: "", updatedAt: null });
      host.planGet = async () => ({ markdown: "", updatedAt: null });
      host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
      host.runtimeList = async () =>
        [
          {
            kind: "opencode",
            runtimeId: "runtime-repo",
            repoPath: "/tmp/repo",
            taskId: null,
            role: "workspace",
            workingDirectory: "/tmp/repo",
            runtimeRoute: {
              type: "local_http" as const,
              endpoint: "http://127.0.0.1:4444",
            },
            startedAt: "2026-02-22T08:00:00.000Z",
            descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
          },
          {
            kind: "opencode",
            runtimeId: "runtime-build",
            repoPath: "/tmp/repo",
            taskId: "task-1",
            role: "build",
            workingDirectory: "/tmp/repo/worktree",
            runtimeRoute: {
              type: "local_http" as const,
              endpoint: "http://127.0.0.1:4444",
            },
            startedAt: "2026-02-22T08:00:00.000Z",
            descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
          },
        ] as Awaited<ReturnType<typeof host.runtimeList>>;
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots = async () => {
        listLiveAgentSessionSnapshotsCalls += 1;
        return runtimeSessionsDeferred.promise;
      };
      OpencodeSdkAdapter.prototype.resumeSession = async (input) => ({
        runtimeKind: input.runtimeKind,
        externalSessionId: input.externalSessionId,
        startedAt: "2026-02-22T08:00:00.000Z",
        role: input.role,
        scenario: input.scenario,
        status: "running",
      });
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
      OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixtureWithPersistedBuildSession],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        await harness.updateArgs({
          tasks: [{ ...taskFixtureWithPersistedBuildSession }],
        });

        expect(listLiveAgentSessionSnapshotsCalls).toBe(1);

        runtimeSessionsDeferred.resolve([
          {
            externalSessionId: "external-1",
            title: "BUILD task-1",
            workingDirectory: "/tmp/repo/worktree",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
            pendingPermissions: [],
            pendingQuestions: [],
          },
        ]);
        await harness.run(async () => {
          await runtimeSessionsDeferred.promise;
        });
        expect(listLiveAgentSessionSnapshotsCalls).toBe(2);
      } finally {
        runtimeSessionsDeferred.resolve([]);
        await harness.unmount();
        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.specGet = originalSpecGet;
        host.planGet = originalPlanGet;
        host.qaGetReport = originalQaGetReport;
        OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
        OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
        OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
        OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      }
    });
  });

  test("retries background session bootstrap after a transient repo config load failure", async () => {
    await withSuppressedRendererWarning(async () => {
      const originalAgentSessionUpsert = host.agentSessionUpsert;
      const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
      const originalRuntimeList = host.runtimeList;
      let repoConfigCalls = 0;
      host.agentSessionUpsert = async () => {};
      host.runtimeList = async () => [createWorktreeRuntimeFixture()];
      host.workspaceGetRepoConfig = async () => {
        repoConfigCalls += 1;
        if (repoConfigCalls === 1) {
          throw new Error("temporary repo config failure");
        }
        return {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/tmp/repo",
          defaultRuntimeKind: "opencode" as const,
          branchPrefix: "obp",
          defaultTargetBranch: { remote: "origin", branch: "main" },
          git: {
            providers: {},
          },
          hooks: {
            preStart: [],
            postComplete: [],
          },
          devServers: [],
          worktreeCopyPaths: [],
          promptOverrides: {},
          agentDefaults: {},
        };
      };

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixtureWithPersistedBuildSession],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        const resolved = await harness.waitFor((state) =>
          state.sessions.some((session) => session.externalSessionId === "external-1"),
        );
        expect(repoConfigCalls).toBe(0);
        expect(
          resolved.sessions.find((session) => session.externalSessionId === "external-1"),
        ).toBeDefined();
      } finally {
        await harness.unmount();
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
        host.runtimeList = originalRuntimeList;
      }
    });
  });

  test("bootstraps task sessions from task list metadata without per-task persisted fetches", async () => {
    await withSuppressedRendererWarning(async () => {
      const originalAgentSessionsList = host.agentSessionsList;
      const originalRuntimeList = host.runtimeList;
      let persistedListCalls = 0;
      host.agentSessionsList = async () => {
        persistedListCalls += 1;
        return [];
      };
      host.runtimeList = async () => [createWorktreeRuntimeFixture()];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixtureWithPersistedBuildSession, taskFixture2WithPersistedBuildSession],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        const resolved = await harness.waitFor((state) =>
          state.sessions.some((session) => session.externalSessionId === "external-2"),
        );
        expect(resolved.sessions.map((session) => session.externalSessionId).sort()).toEqual([
          "external-1",
          "external-2",
        ]);
        expect(persistedListCalls).toBe(0);
      } finally {
        await harness.unmount();
        host.agentSessionsList = originalAgentSessionsList;
        host.runtimeList = originalRuntimeList;
      }
    });
  });

  test("reconciles unaffected tasks without forcing background resume for every live session", async () => {
    await withSuppressedReattachWarning(async () => {
      const originalAgentSessionsList = host.agentSessionsList;
      const originalAgentSessionUpsert = host.agentSessionUpsert;
      const originalSpecGet = host.specGet;
      const originalPlanGet = host.planGet;
      const originalQaGetReport = host.qaGetReport;
      const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
      const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

      host.agentSessionsList = async (_repoPath, taskId) => {
        if (taskId === "task-1") {
          return [persistedBuildSessionFixture];
        }
        if (taskId === "task-2") {
          return [
            {
              ...persistedBuildSessionFixture,
              externalSessionId: "external-2",
              taskId: "task-2",
            },
          ];
        }
        return [];
      };
      host.agentSessionUpsert = async () => {};
      host.specGet = async () => ({ markdown: "", updatedAt: null });
      host.planGet = async () => ({ markdown: "", updatedAt: null });
      host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
      host.runtimeList = async () => [
        {
          kind: "opencode",
          runtimeId: "runtime-1",
          repoPath: "/tmp/repo",
          taskId: null,
          role: "workspace",
          workingDirectory: "/tmp/repo/worktree",
          runtimeRoute: {
            type: "local_http" as const,
            endpoint: "http://127.0.0.1:4444",
          },
          startedAt: "2026-02-22T08:00:00.000Z",
          descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        },
      ];
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots = async () => [
        {
          externalSessionId: "external-1",
          title: "BUILD task-1",
          workingDirectory: "/tmp/repo/worktree",
          startedAt: "2026-02-22T08:00:00.000Z",
          status: { type: "busy" },
          pendingPermissions: [],
          pendingQuestions: [],
        },
        {
          externalSessionId: "external-2",
          title: "BUILD task-2",
          workingDirectory: "/tmp/repo/worktree",
          startedAt: "2026-02-22T08:00:00.000Z",
          status: { type: "busy" },
          pendingPermissions: [],
          pendingQuestions: [],
        },
      ];
      OpencodeSdkAdapter.prototype.resumeSession = async (input) => {
        if (input.externalSessionId === "external-1") {
          throw new Error("task-1 resume failed");
        }
        return {
          runtimeKind: input.runtimeKind,
          externalSessionId: input.externalSessionId,
          startedAt: "2026-02-22T08:00:00.000Z",
          role: input.role,
          scenario: input.scenario,
          status: "running",
        };
      };
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
      OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixtureWithPersistedBuildSession, taskFixture2WithPersistedBuildSession],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        const resolved = await harness.waitFor((state) =>
          state.sessions.some(
            (session) => session.externalSessionId === "external-2" && session.status === "running",
          ),
        );
        expect(
          resolved.sessions.some((session) => session.externalSessionId === "external-1"),
        ).toBe(true);
      } finally {
        await harness.unmount();
        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.specGet = originalSpecGet;
        host.planGet = originalPlanGet;
        host.qaGetReport = originalQaGetReport;
        OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
        OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
        OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
        OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      }
    });
  });

  test("reconciles live agent sessions for tasks added after the first repo bootstrap", async () => {
    await withSuppressedRendererWarning(async () => {
      const originalAgentSessionsList = host.agentSessionsList;
      const originalAgentSessionUpsert = host.agentSessionUpsert;
      const originalSpecGet = host.specGet;
      const originalPlanGet = host.planGet;
      const originalQaGetReport = host.qaGetReport;
      const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
      const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

      host.agentSessionsList = async (_repoPath, taskId) => {
        if (taskId === "task-1") {
          return [persistedBuildSessionFixture];
        }
        if (taskId === "task-2") {
          return [
            {
              ...persistedBuildSessionFixture,
              externalSessionId: "external-2",
              taskId: "task-2",
            },
          ];
        }
        return [];
      };
      host.agentSessionUpsert = async () => {};
      host.specGet = async () => ({ markdown: "", updatedAt: null });
      host.planGet = async () => ({ markdown: "", updatedAt: null });
      host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
      host.runtimeList = async () => [
        {
          kind: "opencode",
          runtimeId: "runtime-1",
          repoPath: "/tmp/repo",
          taskId: null,
          role: "workspace",
          workingDirectory: "/tmp/repo/worktree",
          runtimeRoute: {
            type: "local_http" as const,
            endpoint: "http://127.0.0.1:4444",
          },
          startedAt: "2026-02-22T08:00:00.000Z",
          descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        },
      ];
      OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots = async () => [
        {
          externalSessionId: "external-2",
          title: "BUILD task-2",
          workingDirectory: "/tmp/repo/worktree",
          startedAt: "2026-02-22T08:00:00.000Z",
          status: { type: "busy" },
          pendingPermissions: [],
          pendingQuestions: [],
        },
      ];
      OpencodeSdkAdapter.prototype.resumeSession = async (input) => ({
        runtimeKind: input.runtimeKind,
        externalSessionId: input.externalSessionId,
        startedAt: "2026-02-22T08:00:00.000Z",
        role: input.role,
        scenario: input.scenario,
        status: "running",
      });
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
      OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixtureWithPersistedBuildSession],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        await harness.updateArgs({
          activeRepo: "/tmp/repo",
          tasks: [taskFixtureWithPersistedBuildSession, taskFixture2WithPersistedBuildSession],
        });
        const resolved = await harness.waitFor((state) =>
          state.sessions.some(
            (session) => session.externalSessionId === "external-2" && session.status === "running",
          ),
        );
        expect(
          resolved.sessions.find((session) => session.externalSessionId === "external-2")?.status,
        ).toBe("running");
      } finally {
        await harness.unmount();
        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.specGet = originalSpecGet;
        host.planGet = originalPlanGet;
        host.qaGetReport = originalQaGetReport;
        OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
        OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
        OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
        OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      }
    });
  });
});
