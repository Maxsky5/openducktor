import type { AgentEnginePort, AgentSessionHistoryMessage } from "@openducktor/core";
import type {
  AgentSessionControlSummary,
  AgentWorkflowSessionStartInput,
} from "@openducktor/contracts";
import { errorMessage } from "@/lib/errors";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { createRepoStaleGuard, throwIfRepoStale } from "../support/core";
import { createSessionMessagesState } from "../support/messages";
import { buildSessionHeaderMessages } from "../support/session-prompt";
import { historyToChatMessages } from "../support/session-history-chat-messages";
import {
  resolveAgentSessionRuntimePolicy,
  type LoadSettingsSnapshotForRuntimePolicy,
} from "../support/session-runtime-policy";
import { toRuntimeSessionRefWithPolicy } from "../support/session-runtime-ref";
import type { PreparedSessionLaunch } from "./prepared-session-launch";
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

export type SessionLaunchExecutorDependencies = {
  adapter: SessionLaunchAdapter;
  startWorkflowSession: (
    input: AgentWorkflowSessionStartInput,
  ) => Promise<AgentSessionControlSummary>;
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
  rollback: (input: {
    message: string;
    cause: unknown;
    summary: AgentSessionControlSummary;
    identity: AgentSessionIdentity;
    stopReason: string;
  }) => Promise<never>;
  isCallerContextStale?: (() => boolean) | undefined;
};

export type PreparedSessionLaunchResult = {
  summary: AgentSessionControlSummary;
  sessionAssociation: PreparedSessionLaunch["sessionAssociation"];
};

const callPreparedRuntimeLaunch = (
  deps: Pick<SessionLaunchExecutorDependencies, "adapter" | "startWorkflowSession">,
  launch: PreparedSessionLaunch,
): Promise<AgentSessionControlSummary> => {
  if (launch.mode === "start" && !("workingDirectory" in launch)) {
    const input: AgentWorkflowSessionStartInput = {
      repoPath: launch.repoPath,
      runtimeKind: launch.runtimeKind,
      sessionScope: launch.sessionAssociation,
      systemPrompt: launch.systemPrompt,
      model: launch.selectedModel,
    };
    if (launch.targetWorkingDirectory) {
      input.targetWorkingDirectory = launch.targetWorkingDirectory;
    }
    return deps.startWorkflowSession(input);
  }
  if (launch.mode === "start") {
    return deps.adapter.startSession({
      repoPath: launch.repoPath,
      runtimeKind: launch.runtimeKind,
      workingDirectory: launch.workingDirectory,
      sessionScope: launch.sessionAssociation,
      systemPrompt: launch.systemPrompt,
      model: launch.selectedModel,
    });
  }
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
    return deps.adapter.resumeSession(input);
  }
  const input: Parameters<SessionLaunchAdapter["forkSession"]>[0] = {
    ...runtimeRef,
    systemPrompt: launch.systemPrompt,
    parentExternalSessionId: launch.parentExternalSessionId,
  };
  if (launch.selectedModel) {
    input.model = launch.selectedModel;
  }
  return deps.adapter.forkSession(input);
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

    const summary = await callPreparedRuntimeLaunch(deps, launch);
    const identity = toAgentSessionIdentity(summary);

    if (isStaleOperation()) {
      await input.rollback({
        message: STALE_START_ERROR,
        cause: new Error(STALE_START_ERROR),
        summary,
        identity,
        stopReason: `start-session-stop-on-stale-after-${launch.mode}`,
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
        input.rollback({
          message: `Failed to initialize started session "${identity.externalSessionId}": ${errorMessage(error)}.`,
          cause: error,
          summary,
          identity,
          stopReason: "start-session-stop-after-fork-history-load-failure",
        }),
      );

      if (isStaleOperation()) {
        await input.rollback({
          message: STALE_START_ERROR,
          cause: new Error(STALE_START_ERROR),
          summary,
          identity,
          stopReason: "start-session-stop-on-stale-after-fork-history-load",
        });
      }
      initialMessages = buildForkInitialMessages(launch, summary, forkHistory);
    }

    const sessionState = buildLaunchedSessionState({ launch, summary, initialMessages });
    throwIfRepoStale(isStaleOperation, STALE_START_ERROR);
    await input.register({ summary, identity, sessionState, isStaleOperation });
    if (isStaleOperation()) {
      await input.rollback({
        message: STALE_START_ERROR,
        cause: new Error(STALE_START_ERROR),
        summary,
        identity,
        stopReason: "start-session-stop-on-stale-after-local-registration",
      });
    }

    return {
      summary,
      sessionAssociation: launch.sessionAssociation,
    };
  };
};
