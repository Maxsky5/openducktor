import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import {
  type AgentSessionLiveEnvelope,
  type AgentSessionLiveSnapshot,
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
import { host } from "../shared/host";
import { useAgentOrchestratorOperations } from "./use-agent-orchestrator-operations";

export type OrchestratorDependencies = NonNullable<
  Parameters<typeof useAgentOrchestratorOperations>[0]["dependencies"]
>;

type AgentSessionLiveEnvelopePayload = AgentSessionLiveEnvelope extends infer Envelope
  ? Envelope extends { attachmentId: string }
    ? Omit<Envelope, "attachmentId">
    : never
  : never;

export const createAgentSessionLiveSnapshotFixture = (
  overrides: Omit<Partial<AgentSessionLiveSnapshot>, "ref"> & {
    ref?: Partial<AgentSessionLiveSnapshot["ref"]>;
  } = {},
): AgentSessionLiveSnapshot => {
  const { ref: refOverrides, ...snapshotOverrides } = overrides;
  return {
    ref: {
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
      externalSessionId: "external-1",
      ...refOverrides,
    },
    activity: "idle",
    title: "BUILD task-1",
    startedAt: "2026-02-22T08:00:00.000Z",
    pendingApprovals: [],
    pendingQuestions: [],
    contextUsage: null,
    ...snapshotOverrides,
  };
};

export const createLiveSessionStreamFixture = (
  initialSessions: AgentSessionLiveSnapshot[] = [],
) => {
  let listener: ((payload: unknown) => void) | null = null;
  let attachmentId: string | null = null;
  let attachCount = 0;
  let detachCount = 0;
  let subscribeCount = 0;

  const portOverrides: Partial<OrchestratorDependencies["liveSessionHostPort"]> = {
    subscribeAgentSessionLiveEvents: async (nextListener) => {
      subscribeCount += 1;
      listener = nextListener;
      return {
        transportEpoch: `test:${subscribeCount}`,
        unsubscribe: () => {
          if (listener === nextListener) {
            listener = null;
          }
        },
      };
    },
    agentSessionLiveAttach: async (input) => {
      if (!listener) {
        throw new Error("Live-session attach ran before the test listener was ready.");
      }
      attachCount += 1;
      attachmentId = input.attachmentId;
      listener({
        type: "snapshot",
        attachmentId,
        sessions: initialSessions,
      } satisfies AgentSessionLiveEnvelope);
    },
    agentSessionLiveDetach: async (input) => {
      detachCount += 1;
      if (attachmentId === input.attachmentId) {
        attachmentId = null;
      }
    },
    agentSessionLiveRead: async (ref) => {
      const session = initialSessions.find(
        (candidate) =>
          candidate.ref.repoPath === ref.repoPath &&
          candidate.ref.runtimeKind === ref.runtimeKind &&
          candidate.ref.workingDirectory === ref.workingDirectory &&
          candidate.ref.externalSessionId === ref.externalSessionId,
      );
      return session ? { type: "live", session } : { type: "missing", ref };
    },
  };

  return {
    portOverrides,
    emit: (payload: AgentSessionLiveEnvelopePayload) => {
      if (!listener || !attachmentId) {
        throw new Error("Live-session test stream is not attached.");
      }
      listener({ ...payload, attachmentId } as AgentSessionLiveEnvelope);
    },
    getAttachCount: () => attachCount,
    getDetachCount: () => detachCount,
    getSubscribeCount: () => subscribeCount,
  };
};

export const createTestDependencies = (
  hostOverrides: Partial<OrchestratorDependencies["hostPort"]> = {},
  runtimeHostOverrides: Partial<OrchestratorDependencies["runtimeHostPort"]> = {},
  liveSessionHostOverrides: Partial<OrchestratorDependencies["liveSessionHostPort"]> = {},
): OrchestratorDependencies => {
  let liveEventListener: ((payload: unknown) => void) | null = null;
  return {
    queryClient: new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    }),
    hostPort: {
      agentSessionDelete: async () => undefined,
      agentSessionUpsert: (...args) => host.agentSessionUpsert(...args),
      taskWorktreeGet: (...args) => host.taskWorktreeGet(...args),
      ...hostOverrides,
    },
    runtimeHostPort: {
      gitCanonicalizePath: async (path) => path,
      runtimeEnsure: (...args) => host.runtimeEnsure(...args),
      taskSessionBootstrapPrepare: (...args) => host.taskSessionBootstrapPrepare(...args),
      taskSessionBootstrapComplete: (...args) => host.taskSessionBootstrapComplete(...args),
      taskSessionBootstrapAbort: (...args) => host.taskSessionBootstrapAbort(...args),
      taskSessionStartupLeasePrepare: async () => "lease-1",
      taskSessionStartupLeaseComplete: async () => undefined,
      taskSessionStartupLeaseAbort: async () => undefined,
      ...runtimeHostOverrides,
    },
    liveSessionHostPort: {
      agentSessionLiveAttach: async ({ attachmentId }) => {
        liveEventListener?.({
          type: "snapshot",
          attachmentId,
          sessions: [],
        });
      },
      agentSessionLiveDetach: async () => undefined,
      agentSessionLiveLoadContext: async () => null,
      agentSessionLiveRead: async (ref) => ({ type: "missing", ref }),
      agentSessionLiveReplyApproval: async () => undefined,
      agentSessionLiveReplyQuestion: async () => undefined,
      subscribeAgentSessionLiveEvents: async (listener) => {
        liveEventListener = listener;
        return {
          transportEpoch: "test:0",
          unsubscribe: () => {
            if (liveEventListener === listener) {
              liveEventListener = null;
            }
          },
        };
      },
      ...liveSessionHostOverrides,
    },
  };
};

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

const createChecksStateContextValue = () => ({
  runtimeCheck: null,
  taskStoreCheck: null,
  runtimeCheckFailureKind: null,
  taskStoreCheckFailureKind: null,
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
    loadRepoRuntimeSubagents: async () => ({ subagents: [] }),
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
    agentEngine: args.agentEngine ?? (new OpencodeSdkAdapter() as AgentEnginePort),
    dependencies: args.dependencies ?? createTestDependencies(),
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
          { value: createChecksStateContextValue() },
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
