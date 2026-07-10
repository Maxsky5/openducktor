import type { ReusablePrompt } from "@openducktor/contracts";
import {
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
  REUSABLE_PROMPT_ARGUMENTS_PLACEHOLDER,
} from "@openducktor/contracts";
import type { AgentSlashCommand, AgentUserMessagePart } from "@openducktor/core";
import {
  type AgentChatComposerDraft,
  type AgentChatComposerSegment,
  normalizeComposerDraft,
} from "./agent-chat-composer-draft";

const REUSABLE_PROMPT_COMMAND_ID_PREFIX = "reusable-prompt:";

export const toReusablePromptSlashCommand = (prompt: ReusablePrompt): AgentSlashCommand => ({
  id: `${REUSABLE_PROMPT_COMMAND_ID_PREFIX}${prompt.id}`,
  trigger: prompt.name,
  title: prompt.name,
  ...(prompt.description.trim().length > 0 ? { description: prompt.description } : {}),
  source: "custom",
  hints: [],
});

const isReusablePromptSlashCommand = (command: AgentSlashCommand): boolean =>
  command.source === "custom" && command.id.startsWith(REUSABLE_PROMPT_COMMAND_ID_PREFIX);

const readReusablePromptId = (command: AgentSlashCommand): string | null => {
  if (!isReusablePromptSlashCommand(command)) {
    return null;
  }
  return command.id.slice(REUSABLE_PROMPT_COMMAND_ID_PREFIX.length);
};

const isMeaningfulSegment = (segment: AgentChatComposerSegment): boolean => {
  if (segment.kind === "text") {
    return segment.text.trim().length > 0;
  }
  return true;
};

const expandReusablePromptContent = (content: string, argumentText: string): string => {
  if (content.includes(REUSABLE_PROMPT_ARGUMENTS_PLACEHOLDER)) {
    return content.replaceAll(REUSABLE_PROMPT_ARGUMENTS_PLACEHOLDER, argumentText);
  }
  if (argumentText.length === 0) {
    return content;
  }
  return `${content}\n${argumentText}`;
};

export const resolveReusablePromptDraftToUserMessageParts = (
  draft: AgentChatComposerDraft,
  reusablePrompts: ReusablePrompt[],
): AgentUserMessagePart[] | null => {
  const normalizedDraft = normalizeComposerDraft(draft);
  const slashSegments = normalizedDraft.segments.filter(
    (segment) => segment.kind === "slash_command",
  );
  const customSlashSegment = slashSegments.find((segment) =>
    isReusablePromptSlashCommand(segment.command),
  );

  if (!customSlashSegment) {
    return null;
  }
  if (
    customSlashSegment.command.trigger.toLowerCase() ===
    MANUAL_SESSION_COMPACTION_SLASH_COMMAND.trigger
  ) {
    throw new Error("/compact is reserved for manual session compaction.");
  }
  if (slashSegments.length !== 1) {
    throw new Error("Reusable prompt messages must contain exactly one slash command.");
  }
  if ((normalizedDraft.attachments ?? []).length > 0) {
    throw new Error("Remove attachments before sending a reusable prompt slash command.");
  }

  const slashSegmentIndex = normalizedDraft.segments.findIndex(
    (segment) => segment.id === customSlashSegment.id,
  );
  if (slashSegmentIndex < 0) {
    throw new Error("Reusable prompt slash command is missing from the composer draft.");
  }

  const hasContentBeforeSlash = normalizedDraft.segments
    .slice(0, slashSegmentIndex)
    .some(isMeaningfulSegment);
  if (hasContentBeforeSlash) {
    throw new Error("Reusable prompt slash commands must be the first message item.");
  }

  const trailingTextParts: string[] = [];
  for (const segment of normalizedDraft.segments.slice(slashSegmentIndex + 1)) {
    if (segment.kind === "file_reference") {
      throw new Error("Remove file references before sending a reusable prompt slash command.");
    }
    if (segment.kind === "skill_mention") {
      throw new Error("Remove skill references before sending a reusable prompt slash command.");
    }
    if (segment.kind === "subagent_reference") {
      throw new Error("Remove subagent references before sending a reusable prompt slash command.");
    }
    if (segment.kind === "slash_command") {
      throw new Error("Reusable prompt messages must contain exactly one slash command.");
    }
    trailingTextParts.push(segment.text);
  }

  const promptId = readReusablePromptId(customSlashSegment.command);
  const prompt = reusablePrompts.find((entry) => entry.id === promptId);
  if (!prompt) {
    throw new Error(
      `Reusable prompt "${customSlashSegment.command.trigger}" is no longer available.`,
    );
  }

  const text = expandReusablePromptContent(prompt.content, trailingTextParts.join("").trim());
  if (text.trim().length === 0) {
    throw new Error(
      "Reusable prompt produced an empty message. Add command text or edit the prompt content.",
    );
  }

  return [
    {
      kind: "text",
      text,
    },
  ];
};
