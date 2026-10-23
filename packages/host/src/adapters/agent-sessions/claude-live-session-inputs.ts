import type {
  AgentSessionLivePendingApprovalRequest,
  AgentSessionLivePendingQuestionRequest,
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import type { AgentEvent } from "@openducktor/core";
import { isClaudeSubagentTranscriptTarget } from "../claude/claude-agent-sdk-subagent-transcripts";

export const toClaudeLiveApprovalRequest = (
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

export const toClaudeLiveQuestionRequest = (
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

const isLinkedChild = (parent: AgentSessionLiveSnapshot, child: AgentSessionLiveSnapshot) =>
  child.ref.repoPath === parent.ref.repoPath &&
  child.ref.workingDirectory === parent.ref.workingDirectory &&
  child.parentExternalSessionId === parent.ref.externalSessionId &&
  isClaudeSubagentTranscriptTarget(child.ref.externalSessionId);

export const readClaudeParentSnapshot = (
  snapshot: AgentSessionLiveSnapshot,
  readSnapshot: (ref: AgentSessionLiveRef) => AgentSessionLiveSnapshot | undefined,
): AgentSessionLiveSnapshot | undefined =>
  snapshot.parentExternalSessionId &&
  isClaudeSubagentTranscriptTarget(snapshot.ref.externalSessionId)
    ? readSnapshot({ ...snapshot.ref, externalSessionId: snapshot.parentExternalSessionId })
    : undefined;

export const aggregateClaudeInputActivity = (
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

export const claudeSessionTreeSnapshots = (
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
