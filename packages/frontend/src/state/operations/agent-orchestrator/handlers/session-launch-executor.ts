import type {
  AgentEnginePort,
  AgentSessionHistoryMessage,
  AgentSessionSummary,
} from "@openducktor/core";
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

const FORK_START_HISTORY_LIMIT = 600;

export type SessionLaunchExecutorDependencies = {
  adapter: AgentEnginePort;
  replaceSession: (session: AgentSessionState) => void;
  removeSession: (identity: AgentSessionIdentity) => void;
  loadSettingsSnapshot: LoadSettingsSnapshotForRuntimePolicy;
  repoEpochRef: { current: number };
  currentWorkspaceRepoPathRef: { current: string | null };
};

export type PreparedSessionLaunchCommitInput = {
  summary: AgentSessionSummary;
  identity: AgentSessionIdentity;
  sessionState: AgentSessionState;
  isStaleOperation: () => boolean;
};

export type ExecutePreparedSessionLaunchInput = {
  launch: PreparedSessionLaunch;
  commit?: ((input: PreparedSessionLaunchCommitInput) => Promise<void>) | undefined;
};

export type PreparedSessionLaunchResult = {
  summary: AgentSessionSummary;
  identity: AgentSessionIdentity;
  sessionAssociation: PreparedSessionLaunch["sessionAssociation"];
};

const callPreparedRuntimeLaunch = (
  adapter: AgentEnginePort,
  launch: PreparedSessionLaunch,
): Promise<AgentSessionSummary> => {
  const runtimeRef = {
    repoPath: launch.repoPath,
    runtimeKind: launch.runtimeKind,
    workingDirectory: launch.workingDirectory,
    sessionScope: launch.sessionAssociation,
  };
  if (launch.mode === "resume") {
    return adapter.resumeSession({
      ...runtimeRef,
      externalSessionId: launch.externalSessionId,
      ...(launch.selectedModel ? { model: launch.selectedModel } : {}),
      ...(launch.systemPrompt ? { systemPrompt: launch.systemPrompt } : {}),
    });
  }
  if (launch.mode === "fork") {
    return adapter.forkSession({
      ...runtimeRef,
      systemPrompt: launch.systemPrompt,
      ...(launch.selectedModel ? { model: launch.selectedModel } : {}),
      parentExternalSessionId: launch.parentExternalSessionId,
    });
  }
  return adapter.startSession({
    ...runtimeRef,
    systemPrompt: launch.systemPrompt,
    model: launch.selectedModel,
  });
};

export const buildLaunchedSessionState = ({
  launch,
  summary,
  initialMessages,
}: {
  launch: PreparedSessionLaunch;
  summary: AgentSessionSummary;
  initialMessages?: AgentSessionState["messages"] | undefined;
}): AgentSessionState => ({
  externalSessionId: summary.externalSessionId,
  ...(summary.title ? { title: summary.title } : {}),
  sessionAssociation: launch.sessionAssociation,
  runtimeKind: summary.runtimeKind,
  status: launch.holdForPostStartMessage ? "starting" : "idle",
  runtimeStatusMessage: null,
  startedAt: summary.startedAt,
  workingDirectory: summary.workingDirectory,
  historyLoadState: "loaded",
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
});

const stopLaunchedSession = async ({
  adapter,
  repoPath,
  identity,
}: {
  adapter: AgentEnginePort;
  repoPath: string;
  identity: AgentSessionIdentity;
}): Promise<void> => {
  await adapter.stopSession({ ...identity, repoPath });
};

const throwStopFailure = ({
  cause,
  messagePrefix,
}: {
  cause: unknown;
  messagePrefix: string;
}): never => {
  throw new SessionLaunchStopError(
    `${messagePrefix} Failed to stop the started session during rollback: ${errorMessage(cause)}`,
    { cause },
  );
};

const stopLaunchedSessionOnStaleAndThrow = async ({
  reason,
  adapter,
  repoPath,
  identity,
}: {
  reason: string;
  adapter: AgentEnginePort;
  repoPath: string;
  identity: AgentSessionIdentity;
}): Promise<never> => {
  try {
    await runOrchestratorTask(reason, () => stopLaunchedSession({ adapter, repoPath, identity }));
  } catch (error) {
    if (error instanceof SessionLaunchStopError) {
      throw error;
    }
    throw new SessionLaunchStopError(
      `${STALE_START_ERROR} Failed to stop stale started session '${identity.externalSessionId}': ${errorMessage(error)}`,
      { cause: error },
    );
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
  summary: AgentSessionSummary;
  identity: AgentSessionIdentity;
  deps: SessionLaunchExecutorDependencies;
}): ReturnType<AgentEnginePort["loadSessionHistory"]> => {
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
  summary: AgentSessionSummary,
  forkHistory: Awaited<ReturnType<AgentEnginePort["loadSessionHistory"]>>,
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
    const isStaleOperation = createRepoStaleGuard({
      repoPath: launch.repoPath,
      repoEpochRef: deps.repoEpochRef,
      currentWorkspaceRepoPathRef: deps.currentWorkspaceRepoPathRef,
    });
    throwIfRepoStale(isStaleOperation, STALE_START_ERROR);

    const summary = await callPreparedRuntimeLaunch(deps.adapter, launch);
    const identity = toAgentSessionIdentity(summary);

    if (isStaleOperation()) {
      await stopLaunchedSessionOnStaleAndThrow({
        reason: `start-session-stop-on-stale-after-${launch.mode}`,
        adapter: deps.adapter,
        repoPath: launch.repoPath,
        identity,
      });
    }

    let initialMessages: AgentSessionState["messages"] | undefined;
    if (launch.mode === "fork") {
      const forkHistory: AgentSessionHistoryMessage[] = await loadForkInitialMessages({
        launch,
        summary,
        identity,
        deps,
      }).catch(async (error) => {
        const messagePrefix = `Failed to initialize started session "${identity.externalSessionId}": ${errorMessage(error)}.`;
        try {
          await stopLaunchedSession({
            adapter: deps.adapter,
            repoPath: launch.repoPath,
            identity,
          });
        } catch (stopError) {
          throwStopFailure({ cause: stopError, messagePrefix });
        }
        throw new Error(
          `${messagePrefix} The started session was stopped before local registration.`,
          error instanceof Error ? { cause: error } : undefined,
        );
      });

      if (isStaleOperation()) {
        await stopLaunchedSessionOnStaleAndThrow({
          reason: "start-session-stop-on-stale-after-fork-history-load",
          adapter: deps.adapter,
          repoPath: launch.repoPath,
          identity,
        });
      }
      throwIfRepoStale(isStaleOperation, STALE_START_ERROR);
      initialMessages = buildForkInitialMessages(launch, summary, forkHistory);
    }

    const sessionState = buildLaunchedSessionState({ launch, summary, initialMessages });
    throwIfRepoStale(isStaleOperation, STALE_START_ERROR);
    deps.replaceSession(sessionState);
    if (isStaleOperation()) {
      deps.removeSession(sessionState);
      await stopLaunchedSessionOnStaleAndThrow({
        reason: "start-session-stop-on-stale-after-local-registration",
        adapter: deps.adapter,
        repoPath: launch.repoPath,
        identity,
      });
    }

    if (input.commit) {
      await input.commit({ summary, identity, sessionState, isStaleOperation });
    }

    return {
      summary,
      identity,
      sessionAssociation: launch.sessionAssociation,
    };
  };
};
