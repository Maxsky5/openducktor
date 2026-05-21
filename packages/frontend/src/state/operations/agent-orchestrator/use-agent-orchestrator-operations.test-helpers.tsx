import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import {
  type AgentSessionRecord,
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeInstanceSummary,
  type TaskCard,
} from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { clearAppQueryClient } from "@/lib/query-client";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
import { host } from "../shared/host";
import { createSessionMessagesState } from "./support/messages";
import { createAgentSessionPresenceSnapshotFixture } from "./test-utils";
import { useAgentOrchestratorOperations } from "./use-agent-orchestrator-operations";

type ReadSessionPresenceInput = Parameters<NonNullable<AgentEnginePort["readSessionPresence"]>>[0];
type OrchestratorDependencies = NonNullable<
  Parameters<typeof useAgentOrchestratorOperations>[0]["dependencies"]
>;
type OpencodeSdkAdapterPrototype = Pick<
  OpencodeSdkAdapter,
  "listSessionPresence" | "readSessionPresence"
>;

const opencodeSdkAdapterPrototype = OpencodeSdkAdapter.prototype as OpencodeSdkAdapterPrototype;

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const withSuppressedRendererWarning = async (run: () => Promise<void>) => {
  await run();
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

const persistedSessionFixture: AgentSessionRecord = {
  runtimeKind: "opencode",
  externalSessionId: "external-1",
  role: "build",
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
} as const;

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

const createTestDependencies = (
  hostOverrides: Partial<OrchestratorDependencies["hostPort"]> = {},
  runtimeHostOverrides: Partial<OrchestratorDependencies["runtimeHostPort"]> = {},
): OrchestratorDependencies => ({
  queryClient: new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  }),
  hostPort: {
    agentSessionUpsert: async () => undefined,
    agentSessionStop: async () => undefined,
    taskWorktreeGet: async () => ({
      workingDirectory: "/tmp/repo/worktree",
      source: "active_build_run",
    }),
    ...hostOverrides,
  },
  runtimeHostPort: {
    buildStart: async (_repoPath, _taskId, runtimeKind) => ({
      runtimeKind,
      runtimeId: "runtime-1",
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
      workingDirectory: "/tmp/repo/worktree",
    }),
    runtimeEnsure: async (repoPath, runtimeKind) => ({
      kind: runtimeKind,
      runtimeId: "runtime-1",
      repoPath,
      taskId: null,
      role: "workspace",
      workingDirectory: repoPath,
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
      startedAt: "2026-02-22T08:00:00.000Z",
      descriptor: { ...OPENCODE_RUNTIME_DESCRIPTOR, kind: runtimeKind },
    }),
    ...runtimeHostOverrides,
  },
});

const createHookHarness = (args: {
  activeRepo: string | null;
  activeWorkspace?: import("@openducktor/contracts").WorkspaceRecord | null;
  tasks: TaskCard[];
  refreshTaskData: (repoPath: string) => Promise<void>;
  agentEngine?: OpencodeSdkAdapter;
  dependencies?: OrchestratorDependencies;
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
      dependencies: OrchestratorDependencies;
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

export const setupOrchestratorOperationsTestEnvironment = async () => {
  const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
  const originalBuildContinuationTargetGet = host.taskWorktreeGet;
  const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;
  const originalRuntimeList = host.runtimeList;
  const originalRuntimeEnsure = host.runtimeEnsure;
  const originalListLiveAgentSessionSnapshots = OpencodeSdkAdapter.prototype.listSessionPresence;
  const originalReadAgentSessionPresenceSnapshot = OpencodeSdkAdapter.prototype.readSessionPresence;

  await clearAppQueryClient();
  host.taskWorktreeGet = async () => ({
    workingDirectory: "/tmp/repo/worktree",
  });
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
    general: {
      openAgentStudioTabOnBackgroundSessionStart: true,
    },
    chat: {
      showThinkingMessages: false,
    },
    reusablePrompts: [],
    kanban: {
      doneVisibleDays: 1,
      emptyColumnDisplay: "show" as const,
    },
    autopilot: {
      rules: [],
    },
    agentRuntimes: DEFAULT_AGENT_RUNTIMES,
    workspaces: {},
    globalPromptOverrides: {},
  });
  host.runtimeList = async () => [createWorktreeRuntimeFixture()];
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
  opencodeSdkAdapterPrototype.listSessionPresence = async () => [
    createAgentSessionPresenceSnapshotFixture(),
  ];
  opencodeSdkAdapterPrototype.readSessionPresence = async (input: ReadSessionPresenceInput) => {
    const snapshots = await opencodeSdkAdapterPrototype.listSessionPresence({
      repoPath: input.repoPath ?? "/tmp/repo",
      runtimeKind: input.runtimeKind ?? "opencode",
      directories: [input.workingDirectory ?? "/tmp/repo/worktree"],
    });
    const match = snapshots.find(
      (snapshot: ReturnType<typeof createAgentSessionPresenceSnapshotFixture>) =>
        snapshot.ref.externalSessionId === input.externalSessionId,
    );
    if (match) {
      return match;
    }
    return createAgentSessionPresenceSnapshotFixture({
      ref: {
        repoPath: input.repoPath ?? "/tmp/repo",
        runtimeKind: input.runtimeKind ?? "opencode",
        workingDirectory: input.workingDirectory ?? "/tmp/repo/worktree",
        externalSessionId: input.externalSessionId,
      },
    });
  };

  return () => {
    host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
    host.taskWorktreeGet = originalBuildContinuationTargetGet;
    host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
    host.runtimeList = originalRuntimeList;
    host.runtimeEnsure = originalRuntimeEnsure;
    opencodeSdkAdapterPrototype.listSessionPresence = originalListLiveAgentSessionSnapshots;
    opencodeSdkAdapterPrototype.readSessionPresence = originalReadAgentSessionPresenceSnapshot;
  };
};

export type { OrchestratorDependencies, ReadSessionPresenceInput };
export {
  BUILD_SELECTION,
  buildBootstrapFixture,
  clearAppQueryClient,
  createAgentSessionPresenceSnapshotFixture,
  createDeferred,
  createHookHarness,
  createSessionMessagesState,
  createTestDependencies,
  createWorktreeRuntimeFixture,
  host,
  OPENCODE_RUNTIME_DESCRIPTOR,
  OpencodeSdkAdapter,
  opencodeSdkAdapterPrototype,
  persistedBuildSessionFixture,
  persistedSessionFixture,
  sessionMessagesToArray,
  taskFixture,
  taskFixture2,
  taskFixture2WithPersistedBuildSession,
  taskFixtureWithPersistedBuildSession,
  toast,
  withSuppressedRendererWarning,
};
