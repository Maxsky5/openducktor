import type { AgentSkillReference, AgentUserMessageDisplayPart } from "@openducktor/core";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import type { AgentChatTranscriptSession } from "./agent-chat.types";

const REFERENCE_START_BOUNDARY_PATTERN = /[\s([{"']/u;
const REFERENCE_END_BOUNDARY_PATTERN = /[\s,.;!?)}\]}"']/u;

const hasStartBoundary = (text: string, start: number): boolean =>
  start === 0 || REFERENCE_START_BOUNDARY_PATTERN.test(text[start - 1] ?? "");

const hasEndBoundary = (text: string, end: number): boolean =>
  end === text.length || REFERENCE_END_BOUNDARY_PATTERN.test(text[end] ?? "");

const readSkillMentions = (
  message: AgentChatMessage,
  skills: readonly AgentSkillReference[],
): Extract<AgentUserMessageDisplayPart, { kind: "skill_mention" }>[] => {
  if (message.role !== "user" || message.meta?.kind !== "user") {
    return [];
  }

  const existingRanges: { start: number; end: number }[] = [];
  for (const part of message.meta.parts ?? []) {
    if (
      (part.kind === "file_reference" ||
        part.kind === "skill_mention" ||
        part.kind === "subagent_reference") &&
      part.sourceText
    ) {
      existingRanges.push({
        start: part.sourceText.start,
        end: part.sourceText.end,
      });
    }
  }
  const tokens = skills
    .map((skill) => ({ skill, value: `/${skill.name}` }))
    .sort((left, right) => right.value.length - left.value.length);
  const mentions: Extract<AgentUserMessageDisplayPart, { kind: "skill_mention" }>[] = [];

  for (let start = 0; start < message.content.length; start += 1) {
    if (message.content[start] !== "/" || !hasStartBoundary(message.content, start)) {
      continue;
    }
    const match = tokens.find(({ value }) => {
      const end = start + value.length;
      return message.content.startsWith(value, start) && hasEndBoundary(message.content, end);
    });
    if (!match) {
      continue;
    }
    const end = start + match.value.length;
    const overlapsExistingRange = existingRanges.some(
      (range) => start < range.end && end > range.start,
    );
    if (!overlapsExistingRange) {
      mentions.push({
        kind: "skill_mention",
        skill: match.skill,
        sourceText: {
          value: match.value,
          start,
          end,
        },
      });
    }
    start = end - 1;
  }

  return mentions;
};

const updateRevision = (revision: number, value: string): number => {
  let nextRevision = revision;
  for (let index = 0; index < value.length; index += 1) {
    nextRevision = (nextRevision * 31 + value.charCodeAt(index)) | 0;
  }
  return nextRevision;
};

export const withClaudeSkillMentions = (
  session: AgentChatTranscriptSession,
  skills: readonly AgentSkillReference[],
): AgentChatTranscriptSession => {
  if (session.runtimeKind !== "claude" || skills.length === 0) {
    return session;
  }

  let changed = false;
  let version = session.messages.version;
  const items = session.messages.items.map((message) => {
    const mentions = readSkillMentions(message, skills);
    if (mentions.length === 0 || message.meta?.kind !== "user") {
      return message;
    }
    changed = true;
    for (const mention of mentions) {
      version = updateRevision(
        version,
        `${message.id}:${mention.skill.id}:${mention.sourceText?.start}:${mention.sourceText?.end}`,
      );
    }
    return {
      ...message,
      meta: {
        ...message.meta,
        parts: [...(message.meta.parts ?? []), ...mentions],
      },
    };
  });

  if (!changed) {
    return session;
  }

  return {
    ...session,
    messages: {
      ...session.messages,
      items,
      version,
    },
  };
};
