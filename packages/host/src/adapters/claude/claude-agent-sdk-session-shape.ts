import type {
  AgentSessionRuntimeSnapshot,
  AgentSessionSummary,
  AgentUserMessageDisplayPart,
  SendAgentUserMessageInput,
  SessionRef,
} from "@openducktor/core";
import {
  agentSessionRefsEqual,
  describeAgentSessionScope,
  resolveAgentSessionAssociationTransition,
  toAgentSessionRuntimeSnapshot,
} from "@openducktor/core";
import { HostValidationError } from "../../effect/host-errors";
import { encodeClaudePromptTextWithSourceRanges } from "./claude-agent-sdk-messages";
import type { ClaudeSession, ClaudeSessionInput } from "./claude-agent-sdk-types";
import { claudeSessionRef, claudeSessionScope } from "./claude-agent-sdk-utils";

export const createClaudeSessionSummary = (
  input: ClaudeSessionInput,
  sessionInput: { externalSessionId: string; title?: string },
  startedAt: string,
): AgentSessionSummary => {
  const sessionAssociation = claudeSessionScope(input);
  const summary: AgentSessionSummary = {
    externalSessionId: sessionInput.externalSessionId,
    runtimeKind: "claude",
    workingDirectory: input.workingDirectory,
    sessionAssociation,
    startedAt,
    status: "starting",
  };
  if (sessionInput.title) {
    summary.title = sessionInput.title;
  }
  return summary;
};

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
    if (flattenedTextLength > 0 && text.length > 0) {
      displayParts.push({ kind: "text", text: "\n" });
    }
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
        const skillMention: Extract<AgentUserMessageDisplayPart, { kind: "skill_mention" }> = {
          kind: "skill_mention",
          skill: {
            id: part.command.id,
            name: part.command.trigger,
            path: part.command.trigger,
            title: part.command.title,
          },
          sourceText: offsetSourceText,
        };
        if (part.command.description) {
          skillMention.skill.description = part.command.description;
        }
        displayParts.push(skillMention);
        continue;
      }
      if (part.kind === "text") {
        displayParts.push({ kind: "text", text: part.text });
        continue;
      }
      if (part.kind === "file_reference") {
        const fileReference: Extract<AgentUserMessageDisplayPart, { kind: "file_reference" }> = {
          kind: "file_reference",
          file: part.file,
        };
        if (offsetSourceText) {
          fileReference.sourceText = offsetSourceText;
        }
        displayParts.push(fileReference);
        continue;
      }
      if (part.kind === "skill_mention") {
        const skillMention: Extract<AgentUserMessageDisplayPart, { kind: "skill_mention" }> = {
          kind: "skill_mention",
          skill: part.skill,
        };
        if (offsetSourceText) {
          skillMention.sourceText = offsetSourceText;
        }
        displayParts.push(skillMention);
        continue;
      }
      if (part.kind === "subagent_reference") {
        const subagentReference: Extract<
          AgentUserMessageDisplayPart,
          { kind: "subagent_reference" }
        > = {
          kind: "subagent_reference",
          subagent: part.subagent,
        };
        if (offsetSourceText) {
          subagentReference.sourceText = offsetSourceText;
        }
        displayParts.push(subagentReference);
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
  const snapshot: NonNullable<Parameters<typeof toAgentSessionRuntimeSnapshot>[0]["snapshot"]> = {
    title: session.summary.title ?? "Claude session",
    startedAt: session.startedAt,
    runtimeActivity,
    pendingApprovals: [...session.pendingApprovals.values()].map((entry) => entry.event),
    pendingQuestions: [...session.pendingQuestions.values()].map((entry) => entry.event),
  };
  if (session.parentExternalSessionId) {
    snapshot.parentExternalSessionId = session.parentExternalSessionId;
  }
  return toAgentSessionRuntimeSnapshot({ ref, snapshot });
};

export const assertClaudeSessionRef = (
  session: ClaudeSession,
  ref: SessionRef & { sessionScope?: ClaudeSessionInput["sessionScope"] },
  action: string,
): void => {
  const expected = claudeSessionRef(session);
  if (!agentSessionRefsEqual(expected, ref)) {
    throw new HostValidationError({
      field: "externalSessionId",
      message: `Cannot ${action} Claude session '${ref.externalSessionId}' from repo '${ref.repoPath}' and working directory '${ref.workingDirectory}' because the registered session belongs to repo '${expected.repoPath}' and working directory '${expected.workingDirectory}'.`,
      details: { requested: ref, actual: expected },
    });
  }
  const registeredScope = claudeSessionScope(session.input);
  const transition = resolveAgentSessionAssociationTransition(
    registeredScope,
    ref.sessionScope ?? { kind: "unbound" },
  );
  if (transition.kind === "accepted") {
    return;
  }
  throw new HostValidationError({
    field: "sessionScope",
    message: `Cannot ${action} Claude session '${ref.externalSessionId}' because its registered ${describeAgentSessionScope(transition.previous)} does not match requested ${describeAgentSessionScope(transition.incoming)}.`,
    details: { requested: transition.incoming, actual: transition.previous },
  });
};
