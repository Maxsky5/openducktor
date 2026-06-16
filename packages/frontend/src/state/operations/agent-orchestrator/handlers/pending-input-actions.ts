import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { annotateQuestionToolMessage } from "../support/question-messages";
import { toRuntimeSessionContextRef } from "../support/session-runtime-ref";
import type { SessionTransientState } from "../support/session-transient-state";
import {
  type ReadSessionSnapshot,
  requireLoadedSession,
  requireWorkspaceRepoPath,
} from "./session-action-guards";

type UpdateSession = (
  identity: AgentSessionIdentity,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => AgentSessionState | null;

export type PendingInputActionDependencies = {
  workspaceRepoPath: string | null;
  adapter: Pick<AgentEnginePort, "replyApproval" | "replyQuestion">;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
  turnMetadata: SessionTransientState["turnMetadata"];
  recordTurnUserMessageTimestamp: (
    sessionKey: string,
    timestamp: string | number,
  ) => number | undefined;
  readTurnUserMessageStartedAtMs: (sessionKey: string) => number | undefined;
};

const markTurnUserAnchorIfMissing = (
  dependencies: Pick<
    PendingInputActionDependencies,
    "recordTurnUserMessageTimestamp" | "readTurnUserMessageStartedAtMs" | "turnMetadata"
  >,
  session: AgentSessionState,
): void => {
  const sessionKey = agentSessionIdentityKey(session);
  if (dependencies.readTurnUserMessageStartedAtMs(sessionKey) === undefined) {
    dependencies.recordTurnUserMessageTimestamp(sessionKey, Date.now());
  }
  dependencies.turnMetadata.recordModel(sessionKey, session.selectedModel ?? null);
};

const applyQuestionAnswerToSession = (
  session: AgentSessionState,
  requestId: string,
  answers: string[][],
): Pick<AgentSessionState, "pendingQuestions" | "messages"> => {
  const answeredRequest = session.pendingQuestions.find((entry) => entry.requestId === requestId);
  const pendingQuestions = session.pendingQuestions.filter(
    (entry) => entry.requestId !== requestId,
  );
  if (!answeredRequest || answeredRequest.questions.length === 0) {
    return {
      pendingQuestions,
      messages: session.messages,
    };
  }

  const answeredQuestionsWithAnswers = answeredRequest.questions.map((question, index) => ({
    ...question,
    answers: answers[index] ?? [],
  }));
  return {
    pendingQuestions,
    messages: annotateQuestionToolMessage(
      session,
      requestId,
      answeredQuestionsWithAnswers,
      answers,
    ),
  };
};

export const createPendingInputActions = (dependencies: PendingInputActionDependencies) => {
  const replyAgentApproval = async (
    identity: AgentSessionIdentity,
    requestId: string,
    outcome: RuntimeApprovalReplyOutcome,
    message?: string,
  ): Promise<void> => {
    const session = requireLoadedSession(dependencies.readSessionSnapshot, identity);
    markTurnUserAnchorIfMissing(dependencies, session);
    const repoPath = requireWorkspaceRepoPath(dependencies.workspaceRepoPath);
    await dependencies.adapter.replyApproval({
      ...toRuntimeSessionContextRef(repoPath, session),
      requestId,
      outcome,
      ...(message ? { message } : {}),
    });

    dependencies.updateSession(
      session,
      (current) => ({
        ...current,
        pendingApprovals: current.pendingApprovals.filter((entry) => entry.requestId !== requestId),
      }),
      { persist: false },
    );
  };

  const answerAgentQuestion = async (
    identity: AgentSessionIdentity,
    requestId: string,
    answers: string[][],
  ): Promise<void> => {
    const session = requireLoadedSession(dependencies.readSessionSnapshot, identity);
    markTurnUserAnchorIfMissing(dependencies, session);
    const repoPath = requireWorkspaceRepoPath(dependencies.workspaceRepoPath);
    await dependencies.adapter.replyQuestion({
      ...toRuntimeSessionContextRef(repoPath, session),
      requestId,
      answers,
    });

    dependencies.updateSession(
      session,
      (current) => {
        const { pendingQuestions, messages } = applyQuestionAnswerToSession(
          current,
          requestId,
          answers,
        );

        return {
          ...current,
          pendingQuestions,
          messages,
        };
      },
      { persist: false },
    );
  };

  return {
    replyAgentApproval,
    answerAgentQuestion,
  };
};
