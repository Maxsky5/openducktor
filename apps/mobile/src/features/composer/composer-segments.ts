import type {
  AgentFileSearchResult,
  AgentFileSearchResultKind,
  AgentSkillReference,
  AgentSlashCommand,
  AgentSubagentReference,
} from "@openducktor/core";
import {
  type AgentChatComposerDraft,
  type AgentChatComposerDraftEdit,
  type AgentChatComposerSegment,
  readFileTriggerMatchForDraft,
  readSkillTriggerMatchForDraft,
  readSlashTriggerMatchForDraft,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import type { ReferenceMenuItem } from "@openducktor/frontend-core/sessions/composer/composer-autocomplete-filters";

export type ComposerChipKind = "file" | "subagent" | "slash_command" | "skill";

/** One piece of the composer draft: an editable text run, or a chip. */
export type ComposerToken =
  | { kind: "text"; segmentId: string; text: string }
  | {
      kind: "chip";
      segmentId: string;
      chip: ComposerChipKind;
      /** The text of the desktop chip: a file name, a skill or subagent name, or `/trigger`. */
      label: string;
      /** The chip as plain text, with its trigger prefix, such as `@worker` or `$lint`. */
      text: string;
      /** The kind of a file reference, which picks the chip icon. */
      fileKind: AgentFileSearchResultKind;
    };

const chipFor = (
  segment: Exclude<AgentChatComposerSegment, { kind: "text" }>,
): Extract<ComposerToken, { kind: "chip" }> => {
  switch (segment.kind) {
    case "file_reference":
      return {
        kind: "chip",
        segmentId: segment.id,
        chip: "file",
        label: segment.file.name,
        text: segment.file.name,
        fileKind: segment.file.kind,
      };
    case "subagent_reference":
      return {
        kind: "chip",
        segmentId: segment.id,
        chip: "subagent",
        label: segment.subagent.name,
        text: `@${segment.subagent.name}`,
        fileKind: "default",
      };
    case "slash_command":
      return {
        kind: "chip",
        segmentId: segment.id,
        chip: "slash_command",
        label: `/${segment.command.trigger}`,
        text: `/${segment.command.trigger}`,
        fileKind: "default",
      };
    case "skill_mention":
      return {
        kind: "chip",
        segmentId: segment.id,
        chip: "skill",
        label: segment.skill.name,
        text: `$${segment.skill.name}`,
        fileKind: "default",
      };
  }
};

const subagentLabel = (subagent: AgentSubagentReference): string => subagent.label ?? subagent.name;

const skillLabel = (skill: AgentSkillReference): string =>
  skill.displayName ?? skill.title ?? skill.name;

/** The text runs and chips of a draft, in segment order. A text run sits between chips. */
export const buildComposerTokens = (draft: AgentChatComposerDraft): ComposerToken[] =>
  draft.segments.map((segment) =>
    segment.kind === "text"
      ? { kind: "text", segmentId: segment.id, text: segment.text }
      : chipFor(segment),
  );

/** A short plain text of a draft, for a queued message card or an accessible name. */
export const composerDraftPreview = (draft: AgentChatComposerDraft): string =>
  buildComposerTokens(draft)
    .map((token) => token.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

/** The catalogs that the composer can offer, from the runtime of the session. */
export type ComposerTriggerSupport = {
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  supportsSubagentReferences: boolean;
  supportsSkillReferences: boolean;
};

/** The trigger at the caret: `/` for commands, `@` for files and subagents, `$` for skills. */
export type ComposerTrigger = {
  kind: "slash" | "reference" | "skill";
  textSegmentId: string;
  query: string;
  rangeStart: number;
  rangeEnd: number;
};

/** Reads the trigger that the text before the caret of one text run starts. */
export const readComposerTrigger = (
  draft: AgentChatComposerDraft,
  textSegmentId: string,
  caretOffset: number,
  support: ComposerTriggerSupport,
): ComposerTrigger | null => {
  if (support.supportsSlashCommands) {
    const match = readSlashTriggerMatchForDraft(draft, textSegmentId, caretOffset);
    if (match) return { kind: "slash", textSegmentId, ...match };
  }
  if (support.supportsFileSearch || support.supportsSubagentReferences) {
    const match = readFileTriggerMatchForDraft(draft, textSegmentId, caretOffset);
    if (match) return { kind: "reference", textSegmentId, ...match };
  }
  if (support.supportsSkillReferences) {
    const match = readSkillTriggerMatchForDraft(draft, textSegmentId, caretOffset);
    if (match) return { kind: "skill", textSegmentId, ...match };
  }
  return null;
};

/** A suggestion that the composer can insert as a chip. */
export type ComposerSuggestion =
  | { kind: "slash_command"; id: string; command: AgentSlashCommand }
  | { kind: "skill"; id: string; skill: AgentSkillReference }
  | { kind: "subagent"; id: string; subagent: AgentSubagentReference }
  | { kind: "file"; id: string; file: AgentFileSearchResult };

export const toReferenceSuggestion = (item: ReferenceMenuItem): ComposerSuggestion =>
  item.kind === "subagent"
    ? { kind: "subagent", id: item.id, subagent: item.subagent }
    : { kind: "file", id: item.id, file: item.result };

/**
 * The text of a suggestion row, as the desktop menus: a title, a second line, and a description.
 * Slash commands also show their source.
 */
export type SuggestionText = {
  title: string;
  /** The skill or subagent label, or the file path. */
  subtitle: string | null;
  description: string | null;
  /** The source of a slash command, such as "command" or "skill". */
  source: string | null;
  accessibilityLabel: string;
};

export const suggestionText = (suggestion: ComposerSuggestion): SuggestionText => {
  switch (suggestion.kind) {
    case "slash_command":
      return {
        title: `/${suggestion.command.trigger}`,
        subtitle: null,
        description: suggestion.command.description ?? null,
        source: suggestion.command.source ?? null,
        accessibilityLabel: `Command ${suggestion.command.trigger}`,
      };
    case "skill":
      return {
        title: `$${suggestion.skill.name}`,
        subtitle: skillLabel(suggestion.skill),
        description: suggestion.skill.description ?? null,
        source: null,
        accessibilityLabel: `Skill ${skillLabel(suggestion.skill)}`,
      };
    case "subagent":
      return {
        title: `@${suggestion.subagent.name}`,
        subtitle: subagentLabel(suggestion.subagent),
        description: suggestion.subagent.description ?? null,
        source: null,
        accessibilityLabel: `Subagent ${subagentLabel(suggestion.subagent)}`,
      };
    case "file":
      return {
        title: suggestion.file.name,
        subtitle: suggestion.file.path,
        description: null,
        source: null,
        accessibilityLabel: `File ${suggestion.file.path}`,
      };
  }
};

/** The draft edit that replaces the trigger text with the chip of the suggestion. */
export const insertSuggestionEdit = (
  trigger: ComposerTrigger,
  suggestion: ComposerSuggestion,
): AgentChatComposerDraftEdit => {
  const range = {
    textSegmentId: trigger.textSegmentId,
    rangeStart: trigger.rangeStart,
    rangeEnd: trigger.rangeEnd,
  };
  switch (suggestion.kind) {
    case "slash_command":
      return { type: "insert_slash_command", ...range, command: suggestion.command };
    case "skill":
      return { type: "insert_skill_reference", ...range, skill: suggestion.skill };
    case "subagent":
      return { type: "insert_subagent_reference", ...range, subagent: suggestion.subagent };
    case "file":
      return { type: "insert_file_reference", ...range, file: suggestion.file };
  }
};
