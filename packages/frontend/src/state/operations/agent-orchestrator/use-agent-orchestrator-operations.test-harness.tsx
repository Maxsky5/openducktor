import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import { OPENCODE_RUNTIME_DESCRIPTOR, type TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import { useAgentOrchestratorOperations } from "./use-agent-orchestrator-operations";

export type OrchestratorDependencies = NonNullable<
  Parameters<typeof useAgentOrchestratorOperations>[0]["dependencies"]
>;

export const createTestDependencies = (
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

type ActiveWorkspace = ReturnType<typeof createDefaultActiveWorkspace>;
type OrchestratorHookState = ReturnType<typeof useAgentOrchestratorOperations>;
type OrchestratorHarnessState = OrchestratorHookState &
  AgentOperationsContextValue & {
    sessions: AgentSessionState[];
  };

const toHarnessState = (state: OrchestratorHookState): OrchestratorHarnessState => ({
  get sessions() {
    return state.sessionStore.getActivitySnapshot().sessions.flatMap((summary) => {
      const session = state.sessionStore.getSessionSnapshot(summary);
      return session ? [session] : [];
    });
  },
  ...state.operations,
  ...state,
});

export const createHookHarness = (args: {
  activeRepo: string | null;
  activeWorkspace?: ActiveWorkspace;
  tasks: TaskCard[];
  isLoadingTasks?: boolean;
  refreshTaskData: (repoPath: string) => Promise<void>;
  agentEngine?: AgentEnginePort;
  dependencies?: OrchestratorDependencies;
}) => {
  let latest: OrchestratorHookState | null = null;
  let currentArgs = {
    ...args,
    activeWorkspace: args.activeWorkspace ?? createDefaultActiveWorkspace(args.activeRepo),
    isLoadingTasks: args.isLoadingTasks ?? false,
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
      activeWorkspace: ActiveWorkspace;
      tasks: TaskCard[];
      isLoadingTasks: boolean;
      refreshTaskData: (repoPath: string) => Promise<void>;
      agentEngine: AgentEnginePort;
      dependencies: OrchestratorDependencies;
    }>,
  ) => {
    let activeWorkspace = currentArgs.activeWorkspace;
    if (nextArgs.activeWorkspace !== undefined) {
      activeWorkspace = nextArgs.activeWorkspace;
    } else if (nextArgs.activeRepo !== undefined) {
      activeWorkspace = createDefaultActiveWorkspace(nextArgs.activeRepo);
    }

    currentArgs = {
      ...currentArgs,
      ...nextArgs,
      activeWorkspace,
    };
    await sharedHarness.update(undefined);
  };

  const run = async (callback: () => Promise<void> | void) => {
    await sharedHarness.run(async () => {
      await callback();
    });
  };

  const waitFor = async (predicate: (state: OrchestratorHarnessState) => boolean) => {
    await sharedHarness.waitFor(() => latest !== null && predicate(toHarnessState(latest)));
    return getLatest();
  };

  const getLatest = () => {
    if (!latest) {
      throw new Error("Hook state unavailable");
    }
    return toHarnessState(latest);
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
