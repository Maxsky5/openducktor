import type {
  AgentSessionRuntimeSnapshot,
  AgentSessionSummary,
  AgentUserMessageDisplayPart,
  SendAgentUserMessageInput,
  SessionRef,
} from "@openducktor/core";
import { agentSessionRefsEqual, toAgentSessionRuntimeSnapshot } from "@openducktor/core";
import { HostValidationError } from "../../effect/host-errors";
import { encodeClaudePromptTextWithSourceRanges } from "./claude-agent-sdk-messages";
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
  let flattenedTextLength = 0;
  let promptSegment: Exclude<(typeof parts)[number], { kind: "attachment" }>[] = [];

  const appendPromptSegment = (): void => {
    if (promptSegment.length === 0) {
      return;
    }
    const { sourceTextByPartIndex, text } = encodeClaudePromptTextWithSourceRanges(promptSegment);
    const sourceOffset = flattenedTextLength === 0 ? 0 : flattenedTextLength + 1;
    for (const [index, part] of promptSegment.entries()) {
      const sourceText = sourceTextByPartIndex[index];
      const offsetSourceText = sourceText
        ? {
            ...sourceText,
            start: sourceText.start + sourceOffset,
            end: sourceText.end + sourceOffset,
          }
        : undefined;
      if (part.kind === "slash_command") {
        if (!offsetSourceText) {
          throw new HostValidationError({
            field: "parts",
            message: `Claude command '/${part.command.trigger}' has no encoded source range.`,
            details: { commandId: part.command.id },
          });
        }
        if (part.command.source !== "skill") {
          displayParts.push({ kind: "text", text: offsetSourceText.value });
          continue;
        }
        displayParts.push({
          kind: "skill_mention",
          skill: {
            id: part.command.id,
            name: part.command.trigger,
            path: part.command.trigger,
            title: part.command.title,
            ...(part.command.description ? { description: part.command.description } : {}),
          },
          sourceText: offsetSourceText,
        });
        continue;
      }
      if (part.kind === "text") {
        displayParts.push({ kind: "text", text: part.text });
        continue;
      }
      if (part.kind === "file_reference") {
        displayParts.push({
          kind: "file_reference",
          file: part.file,
          ...(offsetSourceText ? { sourceText: offsetSourceText } : {}),
        });
        continue;
      }
      if (part.kind === "skill_mention") {
        displayParts.push({
          kind: "skill_mention",
          skill: part.skill,
          ...(offsetSourceText ? { sourceText: offsetSourceText } : {}),
        });
        continue;
      }
      if (part.kind === "subagent_reference") {
        displayParts.push({
          kind: "subagent_reference",
          subagent: part.subagent,
          ...(offsetSourceText ? { sourceText: offsetSourceText } : {}),
        });
      }
    }
    flattenedTextLength = sourceOffset + text.length;
    promptSegment = [];
  };

  for (const part of parts) {
    if (part.kind !== "attachment") {
      promptSegment.push(part);
      continue;
    }
    appendPromptSegment();
    displayParts.push({ kind: "attachment", attachment: part.attachment });
  }
  appendPromptSegment();
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
