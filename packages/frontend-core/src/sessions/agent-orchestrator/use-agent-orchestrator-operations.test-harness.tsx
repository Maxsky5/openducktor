import { createOpenCodeAgentEngineTestAdapter } from "./handlers/opencode-agent-engine.test-support";
import { AgentRuntimeTestAdapter } from "../../test-support/agent-runtime-test-adapter";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshot,
  TaskCard,
} from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { HostClient } from "@openducktor/host-client";
import { QueryClient } from "@tanstack/react-query";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { connectionOf } from "../../connection/client-connection";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { createHookHarness as createSharedHookHarness } from "../../test-support/react-hook-harness";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "../../test-support/test-client-connection";
import type { AgentSessionState } from "../../types/agent-orchestrator";
import { useAgentOrchestratorOperations } from "./use-agent-orchestrator-operations";
import { createLiveSnapshotEnvelope } from "../../test-support/agent-session-live-fixture";

export type OrchestratorDependencies = NonNullable<
  Parameters<typeof useAgentOrchestratorOperations>[0]["dependencies"]
>;

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
  let listener: ((payload: AgentSessionLiveEnvelope) => void) | null = null;
  let observeCount = 0;

  const portOverrides: Partial<OrchestratorDependencies["liveSessionHostPort"]> = {
    observeAgentSessionLive: async (input, nextListener) => {
      observeCount += 1;
      listener = nextListener;
      nextListener(
        createLiveSnapshotEnvelope({ repoPath: input.repoPath, sessions: initialSessions }),
      );
      return () => {
        if (listener === nextListener) {
          listener = null;
        }
      };
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
    emit: (payload: AgentSessionLiveEnvelope) => {
      if (!listener) {
        throw new Error("Live-session test stream is not observed.");
      }
      listener(payload);
    },
    getObserveCount: () => observeCount,
  };
};

/**
 * Creates the hook dependencies and a test connection over `host` that owns their query client.
 * The harness renders the hook under that connection.
 */
export const createTestDependencies = (
  host: HostClient,
  hostOverrides: Partial<OrchestratorDependencies["hostPort"]> = {},
  liveSessionHostOverrides: Partial<OrchestratorDependencies["liveSessionHostPort"]> = {},
): OrchestratorDependencies => {
  const { queryClient } = createTestClientConnection({
    host: { ...createTestHostConnection(), client: host },
    queryClient: new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    }),
  });
  return {
    queryClient,
    hostPort: {
      agentSessionsListForTasks: async (_repoPath, taskIds) =>
        taskIds.map((taskId) => ({ taskId, agentSessions: [] })),
      taskMetadataGet: (...args) => host.taskMetadataGet(...args),
      taskWorktreeGet: (...args) => host.taskWorktreeGet(...args),
      ...hostOverrides,
    },
    liveSessionHostPort: {
      observeAgentSessionLive: async ({ repoPath }, listener) => {
        listener(createLiveSnapshotEnvelope({ repoPath, sessions: [] }));
        return () => {};
      },
      agentSessionLiveLoadContext: async () => null,
      agentSessionLiveRead: async (ref) => ({ type: "missing", ref }),
      agentSessionLiveReplyApproval: async () => undefined,
      agentSessionLiveReplyQuestion: async () => undefined,
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
        defaultTargetBranch: null,
        defaultBuildProfileId: null,
        defaultBuildProvider: null,
        defaultBuildModel: null,
        defaultBuildVariant: null,
        defaultQaProfileId: null,
        defaultQaProvider: null,
        defaultQaModel: null,
        defaultQaVariant: null,
        git: {},
        hooks: { postComplete: [] },
        isActive: true,
        hasConfig: true,
        defaultWorktreeBasePath: null,
        configuredWorktreeBasePath: null,
        effectiveWorktreeBasePath: null,
      };

type ActiveWorkspace = ReturnType<typeof createDefaultActiveWorkspace>;
type OrchestratorHookState = ReturnType<typeof useAgentOrchestratorOperations>;

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
  refreshTaskData: (repoPath: string) => Promise<void>;
  agentEngine?: AgentEnginePort;
  /** Create these with `createTestDependencies`; the hook renders under their connection. */
  dependencies: OrchestratorDependencies;
}) => {
  let latest: OrchestratorHookState | null = null;
  let currentArgs = {
    ...args,
    activeWorkspace: args.activeWorkspace ?? createDefaultActiveWorkspace(args.activeRepo),
    isLoadingTasks: args.isLoadingTasks ?? false,
    agentEngine:
      args.agentEngine ?? createOpenCodeAgentEngineTestAdapter(new AgentRuntimeTestAdapter()),
  };

  const Harness = () => {
    latest = useAgentOrchestratorOperations(currentArgs);
    return null;
  };
  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(
      ClientConnectionProvider,
      { connection: connectionOf(currentArgs.dependencies.queryClient) },
      children,
    );

  const sharedHarness = createSharedHookHarness(Harness, undefined, {
    wrapper,
  });

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
