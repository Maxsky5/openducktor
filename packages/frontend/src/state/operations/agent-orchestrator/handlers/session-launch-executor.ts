import type { AgentEnginePort, AgentSessionHistoryMessage } from "@openducktor/core";
import type { AgentSessionControlSummary } from "@openducktor/contracts";
import { errorMessage } from "@/lib/errors";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { createRepoStaleGuard, throwIfRepoStale } from "../support/core";
import { runOrchestratorTask } from "../support/async-side-effects";
import { createSessionMessagesState } from "../support/messages";
import { buildSessionHeaderMessages } from "../support/session-prompt";
import { historyToChatMessages } from "../support/session-history-chat-messages";
import {
  resolveAgentSessionRuntimePolicy,
  type LoadSettingsSnapshotForRuntimePolicy,
} from "../support/session-runtime-policy";
import { toRuntimeSessionRefWithPolicy } from "../support/session-runtime-ref";
import type { PreparedSessionLaunch } from "./prepared-session-launch";
import { SessionLaunchStopError } from "./session-launch-errors";
import { STALE_START_ERROR } from "./start-session-constants";

// Match the requested-history loading cap so newly forked child sessions load
// enough history to render immediately without pulling an unbounded transcript.
const FORK_START_HISTORY_LIMIT = 600;

type SessionLaunchAdapter = Pick<
  AgentEnginePort,
  | "startSession"
  | "resumeSession"
  | "forkSession"
  | "stopSession"
  | "releaseSession"
  | "loadSessionHistory"
>;

type LaunchedSessionStopTags = { repoPath: string; externalSessionId: string };

const launchedSessionStopTags = (
  repoPath: string,
  identity: AgentSessionIdentity,
): LaunchedSessionStopTags => ({ repoPath, externalSessionId: identity.externalSessionId });

export type SessionLaunchExecutorDependencies = {
  adapter: SessionLaunchAdapter;
  removeSession: (identity: AgentSessionIdentity) => void;
  loadSettingsSnapshot: LoadSettingsSnapshotForRuntimePolicy;
  repoEpochRef: { current: number };
  currentWorkspaceRepoPathRef: { current: string | null };
};

export type PreparedSessionRegistrationInput = {
  summary: AgentSessionControlSummary;
  identity: AgentSessionIdentity;
  sessionState: AgentSessionState;
  isStaleOperation: () => boolean;
};

export type ExecutePreparedSessionLaunchInput = {
  launch: PreparedSessionLaunch;
  register: (input: PreparedSessionRegistrationInput) => Promise<void>;
  isCallerContextStale?: (() => boolean) | undefined;
};

export type PreparedSessionLaunchResult = {
  summary: AgentSessionControlSummary;
  sessionAssociation: PreparedSessionLaunch["sessionAssociation"];
};

const callPreparedRuntimeLaunch = (
  adapter: SessionLaunchAdapter,
  launch: PreparedSessionLaunch,
): Promise<AgentSessionControlSummary> => {
  const runtimeRef = {
    repoPath: launch.repoPath,
    runtimeKind: launch.runtimeKind,
    workingDirectory: launch.workingDirectory,
    sessionScope: launch.sessionAssociation,
  };
  if (launch.mode === "resume") {
    const input: Parameters<SessionLaunchAdapter["resumeSession"]>[0] = {
      ...runtimeRef,
      externalSessionId: launch.externalSessionId,
    };
    if (launch.selectedModel) {
      input.model = launch.selectedModel;
    }
    if (launch.systemPrompt) {
      input.systemPrompt = launch.systemPrompt;
    }
    return adapter.resumeSession(input);
  }
  if (launch.mode === "fork") {
    const input: Parameters<SessionLaunchAdapter["forkSession"]>[0] = {
      ...runtimeRef,
      systemPrompt: launch.systemPrompt,
      parentExternalSessionId: launch.parentExternalSessionId,
    };
    if (launch.selectedModel) {
      input.model = launch.selectedModel;
    }
    return adapter.forkSession(input);
  }
  return adapter.startSession({
    ...runtimeRef,
    systemPrompt: launch.systemPrompt,
    model: launch.selectedModel,
  });
};

const launchedSessionStatus = (
  launch: PreparedSessionLaunch,
  summary: AgentSessionControlSummary,
): AgentSessionState["status"] => {
  if (launch.mode === "resume") {
    return summary.status;
  }
  return launch.holdForPostStartMessage ? "starting" : "idle";
};

export const buildLaunchedSessionState = ({
  launch,
  summary,
  initialMessages,
}: {
  launch: PreparedSessionLaunch;
  summary: AgentSessionControlSummary;
  initialMessages?: AgentSessionState["messages"] | undefined;
}): AgentSessionState => {
  const state: AgentSessionState = {
    externalSessionId: summary.externalSessionId,
    sessionAssociation: launch.sessionAssociation,
    runtimeKind: summary.runtimeKind,
    status: launchedSessionStatus(launch, summary),
    runtimeStatusMessage: null,
    startedAt: summary.startedAt,
    workingDirectory: summary.workingDirectory,
    livePresence: "unobserved",
    historyLoadState: launch.mode === "resume" ? "not_requested" : "loaded",
    messages:
      initialMessages ??
      createSessionMessagesState(
        summary.externalSessionId,
        buildSessionHeaderMessages({
          externalSessionId: summary.externalSessionId,
          systemPrompt: launch.systemPrompt ?? "",
          startedAt: summary.startedAt,
        }),
      ),
    contextUsage: null,
    pendingApprovals: [],
    pendingQuestions: [],
    selectedModel: launch.selectedModel ?? null,
  };
  if (summary.title) {
    state.title = summary.title;
  }
  return state;
};

const finalizeLaunchedSession = async ({
  adapter,
  repoPath,
  identity,
  mode,
}: {
  adapter: SessionLaunchAdapter;
  repoPath: string;
  identity: AgentSessionIdentity;
  mode: PreparedSessionLaunch["mode"];
}): Promise<void> => {
  const sessionRef = { ...identity, repoPath };
  if (mode === "resume") {
    await adapter.releaseSession(sessionRef);
    return;
  }
  await adapter.stopSession(sessionRef);
};

const stopAfterFailedForkHistoryLoad = async ({
  error,
  adapter,
  repoPath,
  identity,
  mode,
}: {
  error: unknown;
  adapter: SessionLaunchAdapter;
  repoPath: string;
  identity: AgentSessionIdentity;
  mode: PreparedSessionLaunch["mode"];
}): Promise<never> => {
  const messagePrefix = `Failed to initialize started session "${identity.externalSessionId}": ${errorMessage(error)}.`;
  try {
    await runOrchestratorTask(
      "start-session-stop-after-fork-history-load-failure",
      () => finalizeLaunchedSession({ adapter, repoPath, identity, mode }),
      { tags: launchedSessionStopTags(repoPath, identity) },
    );
  } catch (stopError) {
    throw new SessionLaunchStopError(
      `${messagePrefix} Failed to stop the started session during rollback: ${errorMessage(stopError)}`,
      { cause: stopError },
    );
  }
  throw new Error(
    `${messagePrefix} The started session was stopped before local registration.`,
    error instanceof Error ? { cause: error } : undefined,
  );
};

const stopLaunchedSessionOnStaleAndThrow = async ({
  reason,
  adapter,
  repoPath,
  identity,
  mode,
  removeSession,
}: {
  reason: string;
  adapter: SessionLaunchAdapter;
  repoPath: string;
  identity: AgentSessionIdentity;
  mode: PreparedSessionLaunch["mode"];
  removeSession?: ((identity: AgentSessionIdentity) => void) | undefined;
}): Promise<never> => {
  try {
    await runOrchestratorTask(
      reason,
      () => finalizeLaunchedSession({ adapter, repoPath, identity, mode }),
      {
        tags: launchedSessionStopTags(repoPath, identity),
      },
    );
  } catch (error) {
    throw new SessionLaunchStopError(
      `${STALE_START_ERROR} Failed to stop stale started session '${identity.externalSessionId}': ${errorMessage(error)}`,
      { cause: error },
    );
  }
  if (removeSession) {
    try {
      removeSession(identity);
    } catch (error) {
      throw new SessionLaunchStopError(
        `${STALE_START_ERROR} The stale started session '${identity.externalSessionId}' was finalized but its local registration could not be removed: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }
  throw new Error(STALE_START_ERROR);
};

const loadForkInitialMessages = async ({
  launch,
  summary,
  identity,
  deps,
}: {
  launch: Extract<PreparedSessionLaunch, { mode: "fork" }>;
  summary: AgentSessionControlSummary;
  identity: AgentSessionIdentity;
  deps: SessionLaunchExecutorDependencies;
}): Promise<AgentSessionHistoryMessage[]> => {
  const runtimePolicy = await resolveAgentSessionRuntimePolicy({
    runtimeKind: summary.runtimeKind,
    sessionScope: launch.sessionAssociation,
    loadSettingsSnapshot: deps.loadSettingsSnapshot,
  });
  return deps.adapter.loadSessionHistory({
    ...toRuntimeSessionRefWithPolicy(
      launch.repoPath,
      { ...identity, selectedModel: null },
      runtimePolicy,
    ),
    limit: FORK_START_HISTORY_LIMIT,
  });
};

const buildForkInitialMessages = (
  launch: Extract<PreparedSessionLaunch, { mode: "fork" }>,
  summary: AgentSessionControlSummary,
  forkHistory: AgentSessionHistoryMessage[],
): AgentSessionState["messages"] =>
  createSessionMessagesState(summary.externalSessionId, [
    ...buildSessionHeaderMessages({
      externalSessionId: summary.externalSessionId,
      systemPrompt: launch.systemPrompt,
      startedAt: summary.startedAt,
    }),
    ...historyToChatMessages(forkHistory, {
      role: launch.sessionAssociation.kind === "workflow" ? launch.sessionAssociation.role : null,
    }),
  ]);

export const createExecutePreparedSessionLaunch = (deps: SessionLaunchExecutorDependencies) => {
  return async (input: ExecutePreparedSessionLaunchInput): Promise<PreparedSessionLaunchResult> => {
    const { launch } = input;
    const repositoryStaleGuard = createRepoStaleGuard({
      repoPath: launch.repoPath,
      repoEpochRef: deps.repoEpochRef,
      currentWorkspaceRepoPathRef: deps.currentWorkspaceRepoPathRef,
    });
    const isStaleOperation = (): boolean =>
      repositoryStaleGuard() || (input.isCallerContextStale?.() ?? false);
    throwIfRepoStale(isStaleOperation, STALE_START_ERROR);

    const summary = await callPreparedRuntimeLaunch(deps.adapter, launch);
    const identity = toAgentSessionIdentity(summary);

    if (isStaleOperation()) {
      await stopLaunchedSessionOnStaleAndThrow({
        reason: `start-session-stop-on-stale-after-${launch.mode}`,
        adapter: deps.adapter,
        repoPath: launch.repoPath,
        identity,
        mode: launch.mode,
      });
    }

    let initialMessages: AgentSessionState["messages"] | undefined;
    if (launch.mode === "fork") {
      const forkHistory: AgentSessionHistoryMessage[] = await loadForkInitialMessages({
        launch,
        summary,
        identity,
        deps,
      }).catch((error) =>
        stopAfterFailedForkHistoryLoad({
          error,
          adapter: deps.adapter,
          repoPath: launch.repoPath,
          identity,
          mode: launch.mode,
        }),
      );

      if (isStaleOperation()) {
        await stopLaunchedSessionOnStaleAndThrow({
          reason: "start-session-stop-on-stale-after-fork-history-load",
          adapter: deps.adapter,
          repoPath: launch.repoPath,
          identity,
          mode: launch.mode,
        });
      }
      initialMessages = buildForkInitialMessages(launch, summary, forkHistory);
    }

    const sessionState = buildLaunchedSessionState({ launch, summary, initialMessages });
    throwIfRepoStale(isStaleOperation, STALE_START_ERROR);
    await input.register({ summary, identity, sessionState, isStaleOperation });
    if (isStaleOperation()) {
      await stopLaunchedSessionOnStaleAndThrow({
        reason: "start-session-stop-on-stale-after-local-registration",
        adapter: deps.adapter,
        repoPath: launch.repoPath,
        identity,
        mode: launch.mode,
        removeSession: deps.removeSession,
      });
    }

    return {
      summary,
      sessionAssociation: launch.sessionAssociation,
    };
  };
};
