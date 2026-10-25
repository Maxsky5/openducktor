import type { AgentSkillReference, AgentUserMessageDisplayPart } from "@openducktor/core";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { AgentChatTranscriptSession } from "./agent-chat.types";

const REFERENCE_START_BOUNDARY_PATTERN = /[\s([{"']/u;
const REFERENCE_END_BOUNDARY_PATTERN = /[\s,.;!?)}\]}"']/u;

type SkillMention = Extract<AgentUserMessageDisplayPart, { kind: "skill_mention" }>;
type SkillToken = { skill: AgentSkillReference; value: string };
type MessageProjection = { message: AgentChatMessage; revisionKeys: string[] };
type CatalogCache = {
  tokens: SkillToken[];
  messages: WeakMap<AgentChatMessage, MessageProjection>;
};

const catalogs = new WeakMap<readonly AgentSkillReference[], CatalogCache>();

/** Keep unchanged message objects so streaming updates can reuse transcript rows. */
export const withClaudeSkillMentions = (
  session: AgentChatTranscriptSession,
  skills: readonly AgentSkillReference[],
): AgentChatTranscriptSession => {
  if (session.runtimeKind !== "claude" || skills.length === 0) {
    return session;
  }

  let catalog = catalogs.get(skills);
  if (!catalog) {
    catalog = {
      tokens: skills
        .map((skill) => ({ skill, value: `/${skill.name}` }))
        .sort((left, right) => right.value.length - left.value.length),
      messages: new WeakMap(),
    };
    catalogs.set(skills, catalog);
  }

  let changed = false;
  let version = session.messages.version;
  const items = session.messages.items.map((message) => {
    const projection = projectMessage(message, catalog);
    if (projection.message === message) {
      return message;
    }
    changed = true;
    for (const key of projection.revisionKeys) {
      version = hashText(version, key);
    }
    return projection.message;
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

const projectMessage = (message: AgentChatMessage, catalog: CatalogCache): MessageProjection => {
  const cached = catalog.messages.get(message);
  if (cached) return cached;

  const mentions = readSkillMentions(message, catalog.tokens);
  const projection: MessageProjection = { message, revisionKeys: [] };
  if (mentions.length > 0 && message.meta?.kind === "user") {
    projection.message = {
      ...message,
      meta: { ...message.meta, parts: [...(message.meta.parts ?? []), ...mentions] },
    };
    projection.revisionKeys = mentions.map((mention) => {
      // Cache the skill hash so streaming updates do not hash its metadata again.
      const skillHash = hashText(
        0,
        JSON.stringify([
          mention.skill.id,
          mention.skill.name,
          mention.skill.path,
          mention.skill.title,
          mention.skill.displayName,
          mention.skill.description,
          mention.skill.color,
        ]),
      );
      return `${message.id}:${mention.skill.id}:${mention.sourceText?.start}:${mention.sourceText?.end}:${skillHash}`;
    });
  }
  catalog.messages.set(message, projection);
  return projection;
};

const readSkillMentions = (
  message: AgentChatMessage,
  tokens: readonly SkillToken[],
): SkillMention[] => {
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
  const mentions: SkillMention[] = [];

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

const hasStartBoundary = (text: string, start: number): boolean =>
  start === 0 || REFERENCE_START_BOUNDARY_PATTERN.test(text[start - 1] ?? "");

const hasEndBoundary = (text: string, end: number): boolean =>
  end === text.length || REFERENCE_END_BOUNDARY_PATTERN.test(text[end] ?? "");

const hashText = (seed: number, value: string): number => {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
};
