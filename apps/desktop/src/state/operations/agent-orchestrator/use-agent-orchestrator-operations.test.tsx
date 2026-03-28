import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import {
  type AgentSessionRecord,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RunSummary,
  type TaskCard,
} from "@openducktor/contracts";
import { act } from "react";
import { toast } from "sonner";
import { clearAppQueryClient } from "@/lib/query-client";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { host } from "../shared/host";
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

const originalBuildContinuationTargetGet = host.buildContinuationTargetGet;

beforeEach(async () => {
  await clearAppQueryClient();
  host.buildContinuationTargetGet = async () => ({
    workingDirectory: "/tmp/repo/worktree",
    source: "builder_session",
  });
});

afterEach(() => {
  host.buildContinuationTargetGet = originalBuildContinuationTargetGet;
});

const persistedSessionFixture: AgentSessionRecord = {
  runtimeKind: "opencode",
  sessionId: "session-1",
  externalSessionId: "external-1",
  role: "build",
  scenario: "build_implementation_start",
  startedAt: "2026-02-22T08:00:00.000Z",
  workingDirectory: "/tmp/repo",
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
      sessionId: "session-2",
      externalSessionId: "external-2",
    },
  ],
};

const runningRunFixture: RunSummary = {
  runId: "run-1",
  runtimeKind: "opencode",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4444",
  },
  repoPath: "/tmp/repo",
  taskId: "task-1",
  branch: "obp/task-1",
  worktreePath: "/tmp/repo/worktree",
  port: 4444,
  state: "running",
  lastMessage: null,
  startedAt: "2026-02-22T08:00:00.000Z",
};

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
  tasks: TaskCard[];
  runs: RunSummary[];
  refreshTaskData: (repoPath: string) => Promise<void>;
  agentEngine?: OpencodeSdkAdapter;
}) => {
  let latest: ReturnType<typeof useAgentOrchestratorOperations> | null = null;
  let currentArgs = {
    ...args,
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
      tasks: TaskCard[];
      runs: RunSummary[];
      refreshTaskData: (repoPath: string) => Promise<void>;
      agentEngine: OpencodeSdkAdapter;
    }>,
  ) => {
    currentArgs = {
      ...currentArgs,
      ...nextArgs,
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
    timeoutMs = 1000,
  ) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const state = latest;
      if (state && predicate(state)) {
        return state;
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    throw new Error("Timed out waiting for hook state");
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
  const originalRunsList = host.runsList;
  const originalRuntimeEnsure = host.runtimeEnsure;
  const originalListLiveAgentSessionSnapshots =
    OpencodeSdkAdapter.prototype.listLiveAgentSessionSnapshots;

  beforeEach(() => {
    host.workspaceGetRepoConfig = async () =>
      ({
        promptOverrides: {},
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
      },
      repos: {},
      globalPromptOverrides: {},
    });
    host.runtimeList = async () => [];
    host.runsList = async () => [];
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
    host.runsList = originalRunsList;
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
      const originalBuildContinuationTargetGet = host.buildContinuationTargetGet;

      const originalHasSession = OpencodeSdkAdapter.prototype.hasSession;
      const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
      const originalSendUserMessage = OpencodeSdkAdapter.prototype.sendUserMessage;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
      const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

      host.agentSessionsList = async () => [
        {
          ...persistedSessionFixture,
          workingDirectory: "/tmp/repo/worktree",
        },
      ];
      host.agentSessionUpsert = async () => {};
      host.specGet = async () => ({ markdown: "", updatedAt: null });
      host.planGet = async () => ({ markdown: "", updatedAt: null });
      host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
      host.buildContinuationTargetGet = async () => ({
        workingDirectory: "/tmp/repo/worktree",
        source: "active_build_run",
      });

      OpencodeSdkAdapter.prototype.hasSession = () => true;
      OpencodeSdkAdapter.prototype.subscribeEvents = (_sessionId, _listener) => {
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
        runs: [runningRunFixture],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();

        await harness.run(async () => {
          await harness.getLatest().loadAgentSessions("task-1");
        });

        const sessionState = await harness.waitFor((state) => state.sessions.length === 1);
        const sessionId = sessionState.sessions[0]?.sessionId;
        if (!sessionId) {
          throw new Error("Expected hydrated session id");
        }

        await harness.run(async () => {
          await harness.getLatest().sendAgentMessage(sessionId, "hello");
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
        host.buildContinuationTargetGet = originalBuildContinuationTargetGet;

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

      host.agentSessionsList = async () => [
        {
          ...persistedSessionFixture,
          workingDirectory: "/tmp/repo/worktree",
        },
      ];
      host.agentSessionUpsert = async () => {};
      host.runtimeList = async () => [
        {
          kind: "opencode",
          runtimeId: "runtime-1",
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
      ];

      OpencodeSdkAdapter.prototype.hasSession = () => hasAttachedSession;
      OpencodeSdkAdapter.prototype.resumeSession = async (input) => {
        return {
          sessionId: input.sessionId,
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
          workingDirectory: "/tmp/repo",
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
            agentSessions: [persistedSessionFixture],
          },
        ],
        runs: [],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        await harness.waitFor(() => subscribeCalls === 1);

        await harness.run(async () => {
          await harness.getLatest().reconcileLiveTaskSessions({
            taskId: "task-1",
            persistedRecords: [persistedSessionFixture],
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
      const originalBuildContinuationTargetGet = host.buildContinuationTargetGet;

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
      host.buildContinuationTargetGet = async () => ({
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
        runs: [runningRunFixture],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        await harness.run(async () => {
          await harness.getLatest().loadAgentSessions("task-1");
        });

        await harness.run(async () => {
          await expect(harness.getLatest().sendAgentMessage("session-1", "hello")).rejects.toThrow(
            "Role 'build' is unavailable for task 'task-1' in status 'open'.",
          );
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
        host.buildContinuationTargetGet = originalBuildContinuationTargetGet;

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
      const originalBuildContinuationTargetGet = host.buildContinuationTargetGet;

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
        defaultRuntimeKind: "opencode" as const,
        branchPrefix: "obp",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: {
          providers: {},
        },
        trustedHooks: false,
        hooks: {
          preStart: [],
          postComplete: [],
        },
        devServers: [],
        worktreeFileCopies: [],
        promptOverrides: {},
        agentDefaults: {},
      });
      host.buildStart = async () => runningRunFixture;
      host.buildContinuationTargetGet = async () => ({
        workingDirectory: "/tmp/repo/worktree",
        source: "active_build_run",
      });

      OpencodeSdkAdapter.prototype.startSession = async () => {
        startCalls += 1;
        return {
          runtimeKind: "opencode",
          sessionId: "session-in-memory",
          externalSessionId: "external-in-memory",
          startedAt: "2026-02-22T08:00:00.000Z",
          role: "build",
          scenario: "build_after_human_request_changes",
          status: "idle",
        };
      };
      OpencodeSdkAdapter.prototype.subscribeEvents = (_sessionId, _listener) => () => {};
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixture],
        runs: [runningRunFixture],
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
            sourceSessionId: "session-in-memory",
          });
        });

        expect(firstSessionId).toBe("session-in-memory");
        expect(secondSessionId).toBe("session-in-memory");
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
        host.buildContinuationTargetGet = originalBuildContinuationTargetGet;

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
        sessionId: string;
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
      const originalBuildContinuationTargetGet = host.buildContinuationTargetGet;
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
      host.buildContinuationTargetGet = async () => ({
        workingDirectory: "/tmp/repo/worktree",
        source: "active_build_run",
      });
      host.workspaceGetRepoConfig = async () => ({
        defaultRuntimeKind: "opencode" as const,
        branchPrefix: "obp",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: {
          providers: {},
        },
        trustedHooks: false,
        hooks: {
          preStart: [],
          postComplete: [],
        },
        devServers: [],
        worktreeFileCopies: [],
        promptOverrides: {},
        agentDefaults: {},
      });

      OpencodeSdkAdapter.prototype.startSession = async () => {
        startCalls += 1;
        return startDeferred.promise;
      };
      OpencodeSdkAdapter.prototype.subscribeEvents = (_sessionId, _listener) => () => {};
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixture],
        runs: [runningRunFixture],
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
            sessionId: "session-concurrent",
            externalSessionId: "external-concurrent",
            startedAt: "2026-02-22T08:00:00.000Z",
            role: "build",
            scenario: "build_after_human_request_changes",
            status: "idle",
          });

          [firstSessionId, secondSessionId] = await Promise.all([firstStart, secondStart]);
        });

        expect(firstSessionId).toBe("session-concurrent");
        expect(secondSessionId).toBe("session-concurrent");
        expect(startCalls).toBe(1);
        expect(persistedListCalls).toBe(0);
      } finally {
        await harness.unmount();

        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.specGet = originalSpecGet;
        host.planGet = originalPlanGet;
        host.qaGetReport = originalQaGetReport;
        host.buildContinuationTargetGet = originalBuildContinuationTargetGet;
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
      const originalRunsList = host.runsList;
      const originalRuntimeEnsure = host.runtimeEnsure;
      const originalBuildContinuationTargetGet = host.buildContinuationTargetGet;

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
      host.runtimeList = async () => [];
      host.runsList = async () => [];
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
      host.buildContinuationTargetGet = async () => ({
        workingDirectory: "/tmp/repo/worktree",
        source: "active_build_run",
      });

      OpencodeSdkAdapter.prototype.startSession = async () => {
        startCalls += 1;
        return {
          runtimeKind: "opencode",
          sessionId: "session-unexpected",
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
        runs: [runningRunFixture],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();

        let sessionId = "";
        await harness.run(async () => {
          sessionId = await harness.getLatest().startAgentSession({
            taskId: "task-1",
            role: "build",
            scenario: "build_after_human_request_changes",
            startMode: "reuse",
            sourceSessionId: "session-1",
          });
        });

        expect(sessionId).toBe("session-1");
        expect(startCalls).toBe(0);
        await harness.waitFor((state) =>
          state.sessions.some((entry) => entry.sessionId === "session-1"),
        );
      } finally {
        await harness.unmount();

        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.specGet = originalSpecGet;
        host.planGet = originalPlanGet;
        host.qaGetReport = originalQaGetReport;
        host.runtimeList = originalRuntimeList;
        host.runsList = originalRunsList;
        host.runtimeEnsure = originalRuntimeEnsure;
        host.buildContinuationTargetGet = originalBuildContinuationTargetGet;

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
        ...runningRunFixture,
        repoPath: "/tmp/repo-a",
        worktreePath: "/tmp/repo-a/worktree",
      });
      host.workspaceGetRepoConfig = async () => repoConfigDeferred.promise;

      OpencodeSdkAdapter.prototype.startSession = async () => {
        startCalls += 1;
        return {
          runtimeKind: "opencode",
          sessionId: "session-should-not-start",
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
        runs: [],
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
          defaultRuntimeKind: "opencode" as const,
          branchPrefix: "obp",
          defaultTargetBranch: { remote: "origin", branch: "main" },
          git: {
            providers: {},
          },
          trustedHooks: false,
          hooks: {
            preStart: [],
            postComplete: [],
          },
          devServers: [],
          worktreeFileCopies: [],
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
      const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
      const originalSendUserMessage = OpencodeSdkAdapter.prototype.sendUserMessage;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;

      host.agentSessionsList = async () => [];
      host.agentSessionUpsert = async () => {};
      host.specGet = async () => ({ markdown: "", updatedAt: null });
      host.planGet = async () => ({ markdown: "", updatedAt: null });
      host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
      host.workspaceGetRepoConfig = async () => ({
        defaultRuntimeKind: "opencode" as const,
        branchPrefix: "obp",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: {
          providers: {},
        },
        trustedHooks: false,
        hooks: {
          preStart: [],
          postComplete: [],
        },
        devServers: [],
        worktreeFileCopies: [],
        promptOverrides: {},
        agentDefaults: {},
      });

      OpencodeSdkAdapter.prototype.hasSession = () => true;
      OpencodeSdkAdapter.prototype.startSession = async () => {
        startCalls += 1;
        return {
          runtimeKind: "opencode",
          sessionId: "session-kickoff",
          externalSessionId: "external-kickoff",
          startedAt: "2026-02-22T08:00:00.000Z",
          role: "build",
          scenario: "build_implementation_start",
          status: "idle",
        };
      };
      OpencodeSdkAdapter.prototype.subscribeEvents = (_sessionId, _listener) => () => {};
      OpencodeSdkAdapter.prototype.sendUserMessage = async () => {};
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo-a",
        tasks: [taskFixture],
        runs: [
          {
            ...runningRunFixture,
            repoPath: "/tmp/repo-a",
            worktreePath: "/tmp/repo-a/worktree",
          },
        ],
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

        await expect(startPromise).resolves.toBe("session-kickoff");
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
        OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
        OpencodeSdkAdapter.prototype.sendUserMessage = originalSendUserMessage;
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
      OpencodeSdkAdapter.prototype.subscribeEvents = (_sessionId, listener) => {
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
          sessionId: "session-1",
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
        runs: [runningRunFixture],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();

        await harness.run(async () => {
          await harness.getLatest().loadAgentSessions("task-1");
        });

        await harness.run(async () => {
          await harness.getLatest().sendAgentMessage("session-1", "prime");
        });

        if (!eventHandler) {
          throw new Error("Expected session event handler to be registered");
        }

        await harness.run(async () => {
          eventHandler?.({
            type: "session_error",
            sessionId: "session-1",
            message: "boom",
            timestamp: "2026-02-22T08:00:04.000Z",
          });
          eventHandler?.({
            type: "permission_required",
            sessionId: "session-1",
            requestId: "perm-1",
            permission: "read",
            patterns: ["*.md"],
            metadata: { tool: "read" },
            timestamp: "2026-02-22T08:00:05.000Z",
          });
          eventHandler?.({
            type: "question_required",
            sessionId: "session-1",
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
            state.sessions.find((entry) => entry.sessionId === "session-1")?.pendingPermissions
              .length === 1,
        );
        const pendingSession = pendingState.sessions.find(
          (entry) => entry.sessionId === "session-1",
        );
        expect(pendingSession?.pendingPermissions).toHaveLength(1);
        expect(pendingSession?.pendingQuestions).toHaveLength(1);

        await harness.run(async () => {
          await harness.getLatest().sendAgentMessage("session-1", "hello");
        });

        const recoveredSession = harness
          .getLatest()
          .sessions.find((entry) => entry.sessionId === "session-1");
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
        return runningRunFixture;
      };
      host.workspaceGetRepoConfig = async () => ({
        defaultRuntimeKind: "opencode" as const,
        branchPrefix: "obp",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: {
          providers: {},
        },
        trustedHooks: false,
        hooks: {
          preStart: [],
          postComplete: [],
        },
        devServers: [],
        worktreeFileCopies: [],
        promptOverrides: {},
        agentDefaults: {},
      });

      OpencodeSdkAdapter.prototype.startSession = async (input) => {
        startWorkingDirectory = input.workingDirectory;
        return {
          runtimeKind: "opencode",
          sessionId: "session-updated-runs",
          externalSessionId: "external-updated-runs",
          startedAt: "2026-02-22T08:00:00.000Z",
          role: "build",
          scenario: "build_implementation_start",
          status: "idle",
        };
      };
      OpencodeSdkAdapter.prototype.subscribeEvents = (_sessionId, _listener) => () => {};
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
        models: [],
        defaultModelsByProvider: {},
        profiles: [],
      });
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixture],
        runs: [],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        await harness.updateArgs({ runs: [runningRunFixture] });

        await harness.run(async () => {
          await harness.getLatest().startAgentSession({
            taskId: "task-1",
            role: "build",
            startMode: "fresh",
            selectedModel: BUILD_SELECTION,
          });
        });

        expect(buildStartCalls).toBe(0);
        expect(startWorkingDirectory).toBe(runningRunFixture.worktreePath);
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
        runs: [runningRunFixture],
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
          await expect(harness.getLatest().sendAgentMessage("session-1", "hello")).rejects.toThrow(
            "Role 'build' is unavailable for task 'task-1' in status 'open'.",
          );
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
      const originalBuildContinuationTargetGet = host.buildContinuationTargetGet;

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
      host.buildContinuationTargetGet = async () => ({
        workingDirectory: "/tmp/repo/worktree",
        source: "active_build_run",
      });

      OpencodeSdkAdapter.prototype.startSession = async () => {
        startCalls += 1;
        return {
          runtimeKind: "opencode",
          sessionId: "session-unexpected",
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
        runs: [runningRunFixture],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();

        await harness.run(async () => {
          await harness.getLatest().loadAgentSessions("task-1");
        });
        await harness.waitFor((state) =>
          state.sessions.some((entry) => entry.sessionId === "session-1"),
        );

        let reusedSessionId = "";
        await harness.run(async () => {
          reusedSessionId = await harness.getLatest().startAgentSession({
            taskId: "task-1",
            role: "build",
            scenario: "build_after_human_request_changes",
            startMode: "reuse",
            sourceSessionId: "session-1",
          });
        });

        expect(reusedSessionId).toBe("session-1");
        expect(startCalls).toBe(0);
      } finally {
        await harness.unmount();

        host.agentSessionsList = originalAgentSessionsList;
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.specGet = originalSpecGet;
        host.planGet = originalPlanGet;
        host.qaGetReport = originalQaGetReport;
        host.buildContinuationTargetGet = originalBuildContinuationTargetGet;

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
        runs: [],
        refreshTaskData: async () => {},
      });
      const originalAgentSessionsList = host.agentSessionsList;
      host.agentSessionsList = async () => [
        persistedSessionFixture,
        {
          ...persistedSessionFixture,
          sessionId: "session-spec",
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
            .sessions.map((session) => session.sessionId)
            .sort(),
        ).toEqual(["session-1", "session-spec"]);

        await harness.run(async () => {
          harness.getLatest().removeAgentSessions({ taskId: "task-1", roles: ["build"] });
        });

        expect(harness.getLatest().sessions.map((session) => session.sessionId)).toEqual([
          "session-spec",
        ]);
      } finally {
        host.agentSessionsList = originalAgentSessionsList;
        await harness.unmount();
      }
    });
  });

  test("revisit to the same repo bootstraps task sessions again", async () => {
    await withSuppressedRendererWarning(async () => {
      const originalAgentSessionsList = host.agentSessionsList;
      let persistedListCalls = 0;
      host.agentSessionsList = async () => {
        persistedListCalls += 1;
        return [persistedBuildSessionFixture];
      };

      const harness = createHookHarness({
        activeRepo: "/tmp/repo-a",
        tasks: [taskFixtureWithPersistedBuildSession],
        runs: [],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        await harness.updateArgs({
          activeRepo: null,
          tasks: [],
          runs: [],
        });
        await harness.updateArgs({
          activeRepo: "/tmp/repo-a",
          tasks: [taskFixtureWithPersistedBuildSession],
          runs: [],
        });
        const hydrated = await harness.waitFor((state) => state.sessions.length === 1);
        expect(hydrated.sessions[0]?.sessionId).toBe("session-1");
        expect(persistedListCalls).toBe(0);
      } finally {
        await harness.unmount();
        host.agentSessionsList = originalAgentSessionsList;
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
        sessionId: input.sessionId,
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
        runs: [],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        const resolved = await harness.waitFor((state) =>
          state.sessions.some(
            (session) => session.sessionId === "session-1" && session.status === "running",
          ),
        );
        expect(resolved.sessions.find((session) => session.sessionId === "session-1")?.status).toBe(
          "running",
        );
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

  test("reconciles idle live agent sessions on repo bootstrap", async () => {
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
          status: { type: "idle" },
          pendingPermissions: [],
          pendingQuestions: [],
        },
      ];
      OpencodeSdkAdapter.prototype.resumeSession = async (input) => ({
        runtimeKind: input.runtimeKind,
        sessionId: input.sessionId,
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
      OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixtureWithPersistedBuildSession],
        runs: [],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        const resolved = await harness.waitFor((state) =>
          state.sessions.some(
            (session) => session.sessionId === "session-1" && session.status === "idle",
          ),
        );
        expect(resolved.sessions.find((session) => session.sessionId === "session-1")?.status).toBe(
          "idle",
        );
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
        scannedEndpoints.push(input.runtimeConnection.endpoint ?? "");
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
        sessionId: input.sessionId,
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
        runs: [runningRunFixture],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        await harness.waitFor((state) =>
          state.sessions.some(
            (session) => session.sessionId === "session-1" && session.status === "running",
          ),
        );
        expect(new Set(scannedEndpoints)).toEqual(new Set(["http://127.0.0.1:4444"]));
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
        sessionId: input.sessionId,
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
        runs: [runningRunFixture],
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
        expect(listLiveAgentSessionSnapshotsCalls).toBe(1);
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
      let repoConfigCalls = 0;
      host.agentSessionUpsert = async () => {};
      host.workspaceGetRepoConfig = async () => {
        repoConfigCalls += 1;
        if (repoConfigCalls === 1) {
          throw new Error("temporary repo config failure");
        }
        return {
          defaultRuntimeKind: "opencode" as const,
          branchPrefix: "obp",
          defaultTargetBranch: { remote: "origin", branch: "main" },
          git: {
            providers: {},
          },
          trustedHooks: false,
          hooks: {
            preStart: [],
            postComplete: [],
          },
          devServers: [],
          worktreeFileCopies: [],
          promptOverrides: {},
          agentDefaults: {},
        };
      };

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixtureWithPersistedBuildSession],
        runs: [],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        const resolved = await harness.waitFor(
          (state) => state.sessions.some((session) => session.sessionId === "session-1"),
          2_000,
        );
        expect(repoConfigCalls).toBe(0);
        expect(
          resolved.sessions.find((session) => session.sessionId === "session-1"),
        ).toBeDefined();
      } finally {
        await harness.unmount();
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
      }
    });
  });

  test("bootstraps task sessions from task list metadata without per-task persisted fetches", async () => {
    await withSuppressedRendererWarning(async () => {
      const originalAgentSessionsList = host.agentSessionsList;
      let persistedListCalls = 0;
      host.agentSessionsList = async () => {
        persistedListCalls += 1;
        return [];
      };

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixtureWithPersistedBuildSession, taskFixture2WithPersistedBuildSession],
        runs: [],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        const resolved = await harness.waitFor((state) =>
          state.sessions.some((session) => session.sessionId === "session-2"),
        );
        expect(resolved.sessions.map((session) => session.sessionId).sort()).toEqual([
          "session-1",
          "session-2",
        ]);
        expect(persistedListCalls).toBe(0);
      } finally {
        await harness.unmount();
        host.agentSessionsList = originalAgentSessionsList;
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
              sessionId: "session-2",
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
        if (input.sessionId === "session-1") {
          throw new Error("task-1 resume failed");
        }
        return {
          runtimeKind: input.runtimeKind,
          sessionId: input.sessionId,
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
        runs: [],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        const resolved = await harness.waitFor((state) =>
          state.sessions.some(
            (session) => session.sessionId === "session-2" && session.status === "running",
          ),
        );
        expect(resolved.sessions.some((session) => session.sessionId === "session-1")).toBe(true);
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
              sessionId: "session-2",
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
        sessionId: input.sessionId,
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
        runs: [],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        await harness.updateArgs({
          activeRepo: "/tmp/repo",
          tasks: [taskFixtureWithPersistedBuildSession, taskFixture2WithPersistedBuildSession],
          runs: [],
        });
        const resolved = await harness.waitFor((state) =>
          state.sessions.some(
            (session) => session.sessionId === "session-2" && session.status === "running",
          ),
        );
        expect(resolved.sessions.find((session) => session.sessionId === "session-2")?.status).toBe(
          "running",
        );
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
