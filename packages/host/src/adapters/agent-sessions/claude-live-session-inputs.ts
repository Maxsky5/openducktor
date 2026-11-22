import type {
  AgentSessionLivePendingApprovalRequest,
  AgentSessionLivePendingQuestionRequest,
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import type { AgentEvent, AgentStreamPart } from "@openducktor/core";
import { isClaudeSubagentTranscriptTarget } from "../claude/claude-agent-sdk-subagent-transcripts";
import type { ClaudeSessionContext } from "../claude/claude-agent-sdk-types";

const toApproval = (
  event: Extract<AgentEvent, { type: "approval_required" }>,
): AgentSessionLivePendingApprovalRequest => {
  const request: AgentSessionLivePendingApprovalRequest = {
    requestId: event.requestId,
    requestType: event.requestType,
    title: event.title,
  };
  if (event.summary !== undefined) request.summary = event.summary;
  if (event.details !== undefined) request.details = event.details;
  if (event.affectedPaths !== undefined) request.affectedPaths = event.affectedPaths;
  if (event.command !== undefined) request.command = event.command;
  if (event.action !== undefined) request.action = event.action;
  if (event.tool !== undefined) request.tool = event.tool;
  if (event.mutation !== undefined) request.mutation = event.mutation;
  if (event.supportedReplyOutcomes !== undefined) {
    request.supportedReplyOutcomes = event.supportedReplyOutcomes;
  }
  return request;
};

const toQuestion = (
  event: Extract<AgentEvent, { type: "question_required" }>,
): AgentSessionLivePendingQuestionRequest => {
  const request: AgentSessionLivePendingQuestionRequest = {
    requestId: event.requestId,
    questions: event.questions,
  };
  if (event.blocking !== undefined) request.blocking = event.blocking;
  if (event.canCancel !== undefined) request.canCancel = event.canCancel;
  if (event.unsupportedReason !== undefined) request.unsupportedReason = event.unsupportedReason;
  return request;
};

export type ClaudePendingEvent = Extract<
  AgentEvent,
  { type: "approval_required" | "approval_resolved" | "question_required" | "question_resolved" }
>;

/** The snapshot with the request of the event added, or with the resolved request removed. */
export const withPendingEvent = (
  snapshot: AgentSessionLiveSnapshot,
  event: ClaudePendingEvent,
): AgentSessionLiveSnapshot => {
  if (event.type === "approval_required") {
    const request = toApproval(event);
    return {
      ...snapshot,
      pendingApprovals: [
        ...snapshot.pendingApprovals.filter(
          (candidate) => candidate.requestId !== request.requestId,
        ),
        request,
      ],
    };
  }
  if (event.type === "question_required") {
    const request = toQuestion(event);
    return {
      ...snapshot,
      pendingQuestions: [
        ...snapshot.pendingQuestions.filter(
          (candidate) => candidate.requestId !== request.requestId,
        ),
        request,
      ],
    };
  }
  return {
    ...snapshot,
    pendingApprovals:
      event.type === "approval_resolved"
        ? snapshot.pendingApprovals.filter((candidate) => candidate.requestId !== event.requestId)
        : snapshot.pendingApprovals,
    pendingQuestions:
      event.type === "question_resolved"
        ? snapshot.pendingQuestions.filter((candidate) => candidate.requestId !== event.requestId)
        : snapshot.pendingQuestions,
  };
};

export const readParent = (
  snapshot: AgentSessionLiveSnapshot,
  readSnapshot: (ref: AgentSessionLiveRef) => AgentSessionLiveSnapshot | undefined,
): AgentSessionLiveSnapshot | undefined =>
  snapshot.parentExternalSessionId &&
  isClaudeSubagentTranscriptTarget(snapshot.ref.externalSessionId)
    ? readSnapshot({ ...snapshot.ref, externalSessionId: snapshot.parentExternalSessionId })
    : undefined;

export const inputActivity = (
  snapshot: AgentSessionLiveSnapshot,
  snapshots: Iterable<AgentSessionLiveSnapshot>,
  nativeActivity: AgentSessionLiveSnapshot["activity"] | undefined,
): AgentSessionLiveSnapshot["activity"] => {
  if (snapshot.statusUnavailableReason) return snapshot.activity;
  let awaitingQuestion = snapshot.pendingQuestions.some((question) => question.blocking !== false);
  let awaitingPermission = snapshot.pendingApprovals.length > 0;
  for (const child of snapshots) {
    if (isLinkedChild(snapshot, child) && !child.statusUnavailableReason) {
      awaitingQuestion ||= child.activity === "waiting_for_question";
      awaitingPermission ||= child.activity === "waiting_for_permission";
    }
  }
  if (awaitingQuestion) return "waiting_for_question";
  if (awaitingPermission) return "waiting_for_permission";
  return nativeActivity ?? snapshot.activity;
};

export const sessionTree = (
  root: AgentSessionLiveSnapshot,
  snapshots: Iterable<AgentSessionLiveSnapshot>,
): AgentSessionLiveSnapshot[] => {
  const candidates = [...snapshots];
  const affected = [root];
  const seen = new Set([root.ref.externalSessionId]);
  for (let index = 0; index < affected.length; index += 1) {
    const parent = affected[index];
    for (const candidate of candidates) {
      if (
        parent &&
        isLinkedChild(parent, candidate) &&
        !seen.has(candidate.ref.externalSessionId)
      ) {
        seen.add(candidate.ref.externalSessionId);
        affected.push(candidate);
      }
    }
  }
  return affected;
};

const isLinkedChild = (
  parent: AgentSessionLiveSnapshot,
  child: AgentSessionLiveSnapshot,
): boolean =>
  child.ref.repoPath === parent.ref.repoPath &&
  child.ref.workingDirectory === parent.ref.workingDirectory &&
  child.parentExternalSessionId === parent.ref.externalSessionId &&
  isClaudeSubagentTranscriptTarget(child.ref.externalSessionId);

export const eventRef = (
  session: ClaudeSessionContext,
  event: { readonly externalSessionId: string },
): AgentSessionLiveRef => ({
  repoPath: session.input.repoPath,
  runtimeKind: "claude",
  workingDirectory: session.input.workingDirectory,
  externalSessionId: event.externalSessionId,
});

export const subagentStartedAt = (
  part: Pick<Extract<AgentStreamPart, { kind: "subagent" }>, "startedAtMs">,
  fallback: string,
): string => {
  if (part.startedAtMs === undefined) {
    return fallback;
  }
  const startedAt = new Date(part.startedAtMs);
  return Number.isNaN(startedAt.getTime()) ? fallback : startedAt.toISOString();
};
