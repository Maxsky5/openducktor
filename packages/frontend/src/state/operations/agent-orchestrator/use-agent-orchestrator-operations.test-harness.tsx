import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type TaskCard,
} from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { getAvailableRuntimeDefinitions } from "@/lib/agent-runtime";
import {
  ChecksStateContext,
  RepoRuntimeHealthContext,
  RuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { createRepoRuntimeHealthFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";
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

const createChecksStateContextValue = (runtimeHealthByRuntime: RepoRuntimeHealthMap) => ({
  runtimeCheck: null,
  taskStoreCheck: null,
  runtimeCheckFailureKind: null,
  taskStoreCheckFailureKind: null,
  runtimeHealthByRuntime,
  isLoadingChecks: false,
  refreshChecks: async () => undefined,
});

const createRepoRuntimeHealthContextValue = (runtimeHealthByRuntime: RepoRuntimeHealthMap) => ({
  runtimeHealthByRuntime,
  isLoadingRepoRuntimeHealth: false,
  refreshRepoRuntimeHealth: async () => runtimeHealthByRuntime,
});

const createRuntimeDefinitionsContextValue = () => {
  const runtimeDefinitions = [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR];
  return {
    runtimeDefinitions,
    availableRuntimeDefinitions: getAvailableRuntimeDefinitions({
      runtimeDefinitions,
      agentRuntimes: DEFAULT_AGENT_RUNTIMES,
    }),
    agentRuntimes: DEFAULT_AGENT_RUNTIMES,
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    refreshRuntimeDefinitions: async () => runtimeDefinitions,
    loadRepoRuntimeCatalog: async () => {
      throw new Error("Test runtime catalog loader was not configured.");
    },
    loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
    loadRepoRuntimeSkills: async () => ({ skills: [] }),
    loadRepoRuntimeFileSearch: async () => [],
  };
};

export const listHarnessSessions = (state: OrchestratorHookState): AgentSessionState[] =>
  state.sessionStore.getActivitySnapshot().sessions.flatMap((summary) => {
    const session = state.sessionStore.getSessionSnapshot(summary);
    return session ? [session] : [];
  });

export const createHookHarness = (args: {
  activeRepo: string | null;
  activeWorkspace?: ActiveWorkspace;
  tasks: TaskCard[];
  isLoadingTasks?: boolean;
  runtimeHealthByRuntime?: RepoRuntimeHealthMap;
  refreshTaskData: (repoPath: string) => Promise<void>;
  agentEngine?: AgentEnginePort;
  dependencies?: OrchestratorDependencies;
}) => {
  let latest: OrchestratorHookState | null = null;
  let currentArgs = {
    ...args,
    activeWorkspace: args.activeWorkspace ?? createDefaultActiveWorkspace(args.activeRepo),
    isLoadingTasks: args.isLoadingTasks ?? false,
    runtimeHealthByRuntime: args.runtimeHealthByRuntime ?? {
      opencode: createRepoRuntimeHealthFixture(),
    },
    agentEngine: args.agentEngine ?? new OpencodeSdkAdapter(),
  };

  const Harness = () => {
    latest = useAgentOrchestratorOperations(currentArgs);
    return null;
  };
  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(
      RuntimeDefinitionsContext.Provider,
      { value: createRuntimeDefinitionsContextValue() },
      createElement(
        RepoRuntimeHealthContext.Provider,
        { value: createRepoRuntimeHealthContextValue(currentArgs.runtimeHealthByRuntime) },
        createElement(
          ChecksStateContext.Provider,
          { value: createChecksStateContextValue(currentArgs.runtimeHealthByRuntime) },
          children,
        ),
      ),
    );

  const sharedHarness = createSharedHookHarness(Harness, undefined, { wrapper });

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
      runtimeHealthByRuntime: RepoRuntimeHealthMap;
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

  const waitFor = async (predicate: (state: OrchestratorHookState) => boolean) => {
    await sharedHarness.waitFor(() => latest !== null && predicate(latest));
    return getLatest();
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
