import type {
  AgentSessionRuntimeSnapshot,
  AgentSessionSummary,
  AgentUserMessageDisplayPart,
  ListSessionRuntimeSnapshotsInput,
  SendAgentUserMessageInput,
  SessionRef,
} from "@openducktor/core";
import {
  agentSessionRefKey,
  agentSessionRefsEqual,
  agentSessionRuntimeStreamKey,
  toAgentSessionRuntimeSnapshot,
} from "@openducktor/core";
import { HostValidationError } from "../../effect/host-errors";
import type { ClaudeSession, ClaudeSessionInput } from "./claude-agent-sdk-types";
import { claudeSessionRef, claudeWorkflowRole } from "./claude-agent-sdk-utils";

export const createClaudeSessionSummary = (
  input: ClaudeSessionInput,
  sessionInput: { externalSessionId: string; title?: string },
  startedAt: string,
): AgentSessionSummary => ({
  externalSessionId: sessionInput.externalSessionId,
  runtimeKind: "claude",
  workingDirectory: input.workingDirectory,
  ...(sessionInput.title ? { title: sessionInput.title } : {}),
  role: claudeWorkflowRole(input),
  startedAt,
  status: "starting",
});

export const toClaudeDisplayParts = (
  parts: SendAgentUserMessageInput["parts"],
): AgentUserMessageDisplayPart[] => {
  const displayParts: AgentUserMessageDisplayPart[] = [];
  for (const part of parts) {
    if (part.kind === "slash_command") {
      continue;
    }
    if (part.kind === "text") {
      displayParts.push({ kind: "text", text: part.text });
      continue;
    }
    if (part.kind === "file_reference") {
      displayParts.push({ kind: "file_reference", file: part.file });
      continue;
    }
    if (part.kind === "skill_mention") {
      displayParts.push({ kind: "skill_mention", skill: part.skill });
      continue;
    }
    if (part.kind === "subagent_reference") {
      displayParts.push({ kind: "subagent_reference", subagent: part.subagent });
      continue;
    }
    if (part.kind === "attachment") {
      displayParts.push({ kind: "attachment", attachment: part.attachment });
    }
  }
  return displayParts;
};

export const snapshotForClaudeSession = (session: ClaudeSession): AgentSessionRuntimeSnapshot => {
  const ref = claudeSessionRef(session);
  if (session.activity === "stopped") {
    return toAgentSessionRuntimeSnapshot({ ref, snapshot: null });
  }
  const runtimeActivity =
    session.sdkState === "idle" &&
    session.activeSdkUserTurnCount === 0 &&
    session.pendingUserTurnCount === 0 &&
    session.queuedSdkMessages.length === 0
      ? "idle"
      : session.activity;
  return toAgentSessionRuntimeSnapshot({
    ref,
    snapshot: {
      ...(session.parentExternalSessionId
        ? { parentExternalSessionId: session.parentExternalSessionId }
        : {}),
      title: session.summary.title ?? "Claude session",
      startedAt: session.startedAt,
      runtimeActivity,
      pendingApprovals: [...session.pendingApprovals.values()].map((entry) => entry.event),
      pendingQuestions: [...session.pendingQuestions.values()].map((entry) => entry.event),
    },
  });
};

export const snapshotForClaudeSubagentSession = (
  session: ClaudeSession,
  ref: SessionRef,
): AgentSessionRuntimeSnapshot => {
  if (session.activity === "stopped") {
    return toAgentSessionRuntimeSnapshot({ ref, snapshot: null });
  }
  const pendingApprovals = [...session.pendingApprovals.values()]
    .map((entry) => entry.event)
    .filter((event) => event.childExternalSessionId === ref.externalSessionId);
  const pendingQuestions = [...session.pendingQuestions.values()]
    .map((entry) => entry.event)
    .filter((event) => event.childExternalSessionId === ref.externalSessionId);
  return toAgentSessionRuntimeSnapshot({
    ref,
    snapshot: {
      parentExternalSessionId: session.externalSessionId,
      title: "Claude subagent",
      startedAt: session.startedAt,
      runtimeActivity: session.activity,
      pendingApprovals,
      pendingQuestions,
    },
  });
};

export const emptyClaudeSessionSnapshot = (ref: SessionRef): AgentSessionRuntimeSnapshot =>
  toAgentSessionRuntimeSnapshot({ ref, snapshot: null });

export const matchesClaudeSessionRuntimeSnapshotQuery = (
  session: ClaudeSession,
  input: ListSessionRuntimeSnapshotsInput,
): boolean => {
  if (
    agentSessionRuntimeStreamKey(claudeSessionRef(session)) !== agentSessionRuntimeStreamKey(input)
  ) {
    return false;
  }
  if (!input.directories) {
    return true;
  }
  const sessionKey = agentSessionRefKey(claudeSessionRef(session));
  return input.directories.some(
    (workingDirectory) =>
      sessionKey ===
      agentSessionRefKey({
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
        workingDirectory,
        externalSessionId: session.externalSessionId,
      }),
  );
};

export const assertClaudeSessionRef = (
  session: ClaudeSession,
  ref: SessionRef,
  action: string,
): void => {
  const expected = claudeSessionRef(session);
  if (agentSessionRefsEqual(expected, ref)) {
    return;
  }
  throw new HostValidationError({
    field: "externalSessionId",
    message: `Cannot ${action} Claude session '${ref.externalSessionId}' from repo '${ref.repoPath}' and working directory '${ref.workingDirectory}' because the registered session belongs to repo '${expected.repoPath}' and working directory '${expected.workingDirectory}'.`,
    details: { requested: ref, actual: expected },
  });
};
