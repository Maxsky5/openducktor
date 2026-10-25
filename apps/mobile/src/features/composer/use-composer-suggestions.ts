import type { AgentFileSearchResult } from "@openducktor/core";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  buildReferenceMenuItems,
  filterSkills,
  filterSlashCommands,
  filterSubagents,
} from "@openducktor/frontend-core/sessions/composer/composer-autocomplete-filters";
import type { SessionPromptInput } from "@openducktor/frontend-core/sessions/composer/prompt-input/use-session-prompt-input";
import { useEffect, useMemo, useState } from "react";
import {
  type ComposerSuggestion,
  type ComposerTrigger,
  toReferenceSuggestion,
} from "./composer-segments";

/** The rows that the suggestion list shows at most. Typing narrows a long catalog. */
const MAX_SUGGESTIONS = 30;
const FILE_SEARCH_DEBOUNCE_MS = 150;

export type ComposerSuggestions = {
  items: ComposerSuggestion[];
  /** True while the file search for the `@` query runs. */
  isLoading: boolean;
  /** Why the catalog or file search failed, or null. */
  error: string | null;
  /** Reads a failed catalog again, when the failure allows a retry. */
  retry: (() => void) | null;
};

const NONE: ComposerSuggestions = { items: [], isLoading: false, error: null, retry: null };

type FileSearch = {
  query: string;
  results: AgentFileSearchResult[];
  error: string | null;
  pending: boolean;
};

/**
 * The suggestions for the trigger at the caret: slash commands, skills, or subagents and files.
 * The file search waits a moment after the last key, so fast typing sends one search. The rows
 * change only with the trigger and the catalogs, so a composer render keeps the rows and their
 * memoized views.
 */
export function useComposerSuggestions(
  trigger: ComposerTrigger | null,
  promptInput: SessionPromptInput,
): ComposerSuggestions {
  const { slashCommands, skills, subagents, searchFiles, support } = promptInput;
  const { supportsFileSearch, supportsSubagentReferences } = support;
  const fileQuery = trigger?.kind === "reference" && supportsFileSearch ? trigger.query : null;
  const [fileSearch, setFileSearch] = useState<FileSearch | null>(null);

  useEffect(() => {
    if (fileQuery === null) return;
    let active = true;
    const timer = setTimeout(() => {
      setFileSearch({ query: fileQuery, results: [], error: null, pending: true });
      searchFiles(fileQuery).then(
        (results) => {
          if (active) setFileSearch({ query: fileQuery, results, error: null, pending: false });
        },
        (cause: Error) => {
          if (active) {
            setFileSearch({
              query: fileQuery,
              results: [],
              error: `Failed to search files. ${errorMessage(cause)}`,
              pending: false,
            });
          }
        },
      );
    }, FILE_SEARCH_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [fileQuery, searchFiles]);

  const commandCatalog = slashCommands.slashCommands;
  const skillCatalog = skills.skills;
  const subagentCatalog = subagents.subagents;
  const current =
    trigger?.kind === "reference" && fileSearch?.query === trigger.query ? fileSearch : null;
  const items = useMemo((): ComposerSuggestion[] => {
    if (!trigger) return [];
    if (trigger.kind === "slash") {
      return filterSlashCommands(commandCatalog, trigger.query)
        .slice(0, MAX_SUGGESTIONS)
        .map((command) => ({ kind: "slash_command", id: `command:${command.id}`, command }));
    }
    if (trigger.kind === "skill") {
      return filterSkills(skillCatalog, trigger.query)
        .slice(0, MAX_SUGGESTIONS)
        .map((skill) => ({ kind: "skill", id: `skill:${skill.id}`, skill }));
    }
    const subagentMatches = supportsSubagentReferences
      ? filterSubagents(subagentCatalog, trigger.query)
      : [];
    return buildReferenceMenuItems(subagentMatches, current?.results ?? [], trigger.query)
      .slice(0, MAX_SUGGESTIONS)
      .map(toReferenceSuggestion);
  }, [commandCatalog, current, skillCatalog, subagentCatalog, supportsSubagentReferences, trigger]);

  if (!trigger) return NONE;
  if (trigger.kind === "slash") {
    return {
      items,
      isLoading: slashCommands.isSlashCommandsLoading,
      error: slashCommands.slashCommandsError,
      retry: slashCommands.retrySlashCommands,
    };
  }
  if (trigger.kind === "skill") {
    return {
      items,
      isLoading: skills.isSkillsLoading,
      error: skills.skillsError,
      retry: skills.retrySkills,
    };
  }
  return {
    items,
    isLoading:
      subagents.isSubagentsLoading || (supportsFileSearch && (current === null || current.pending)),
    error: current?.error ?? subagents.subagentsError,
    retry: current?.error ? null : subagents.retrySubagents,
  };
}
