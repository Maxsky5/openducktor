import type { CustomPrompt } from "@openducktor/contracts";
import { CUSTOM_PROMPT_ARGUMENTS_PLACEHOLDER } from "@openducktor/contracts";
import type { AgentSlashCommand, AgentUserMessagePart } from "@openducktor/core";
import {
  type AgentChatComposerDraft,
  type AgentChatComposerSegment,
  normalizeComposerDraft,
} from "./agent-chat-composer-draft";

export const CUSTOM_PROMPT_COMMAND_ID_PREFIX = "custom-prompt:";

export const toCustomPromptSlashCommand = (prompt: CustomPrompt): AgentSlashCommand => ({
  id: `${CUSTOM_PROMPT_COMMAND_ID_PREFIX}${prompt.id}`,
  trigger: prompt.name,
  title: prompt.name,
  ...(prompt.description.trim().length > 0 ? { description: prompt.description } : {}),
  source: "custom",
  hints: [],
});

export const isCustomPromptSlashCommand = (command: AgentSlashCommand): boolean =>
  command.source === "custom" && command.id.startsWith(CUSTOM_PROMPT_COMMAND_ID_PREFIX);

export const readCustomPromptId = (command: AgentSlashCommand): string | null => {
  if (!isCustomPromptSlashCommand(command)) {
    return null;
  }
  return command.id.slice(CUSTOM_PROMPT_COMMAND_ID_PREFIX.length);
};

const isMeaningfulSegment = (segment: AgentChatComposerSegment): boolean => {
  if (segment.kind === "text") {
    return segment.text.trim().length > 0;
  }
  return true;
};

const expandCustomPromptContent = (content: string, argumentText: string): string => {
  if (content.includes(CUSTOM_PROMPT_ARGUMENTS_PLACEHOLDER)) {
    return content.replaceAll(CUSTOM_PROMPT_ARGUMENTS_PLACEHOLDER, argumentText);
  }
  if (argumentText.length === 0) {
    return content;
  }
  return `${content}\n${argumentText}`;
};

export const resolveCustomPromptDraftToUserMessageParts = (
  draft: AgentChatComposerDraft,
  customPrompts: CustomPrompt[],
): AgentUserMessagePart[] | null => {
  const normalizedDraft = normalizeComposerDraft(draft);
  const slashSegments = normalizedDraft.segments.filter(
    (segment) => segment.kind === "slash_command",
  );
  const customSlashSegment = slashSegments.find((segment) =>
    isCustomPromptSlashCommand(segment.command),
  );

  if (!customSlashSegment) {
    return null;
  }
  if (slashSegments.length !== 1) {
    throw new Error("Custom prompt sends support exactly one slash command.");
  }
  if ((normalizedDraft.attachments ?? []).length > 0) {
    throw new Error("Remove attachments before sending a custom prompt slash command.");
  }

  const slashSegmentIndex = normalizedDraft.segments.findIndex(
    (segment) => segment.id === customSlashSegment.id,
  );
  if (slashSegmentIndex < 0) {
    throw new Error("Custom prompt slash command is missing from the composer draft.");
  }

  const hasContentBeforeSlash = normalizedDraft.segments
    .slice(0, slashSegmentIndex)
    .some(isMeaningfulSegment);
  if (hasContentBeforeSlash) {
    throw new Error("Custom prompt slash commands must be the first message item.");
  }

  const trailingTextParts: string[] = [];
  for (const segment of normalizedDraft.segments.slice(slashSegmentIndex + 1)) {
    if (segment.kind === "file_reference") {
      throw new Error("Remove file references before sending a custom prompt slash command.");
    }
    if (segment.kind === "slash_command") {
      throw new Error("Custom prompt sends support exactly one slash command.");
    }
    trailingTextParts.push(segment.text);
  }

  const promptId = readCustomPromptId(customSlashSegment.command);
  const prompt = customPrompts.find((entry) => entry.id === promptId);
  if (!prompt) {
    throw new Error(
      `Custom prompt "${customSlashSegment.command.trigger}" is no longer available.`,
    );
  }

  return [
    {
      kind: "text",
      text: expandCustomPromptContent(prompt.content, trailingTextParts.join("").trim()),
    },
  ];
};
