import type {
  AgentFileSearchResult,
  AgentSkillReference,
  AgentSlashCommand,
} from "@openducktor/core";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import type {
  AgentChatComposerDraft,
  AgentChatFileTriggerMatch,
  AgentChatSkillTriggerMatch,
} from "./agent-chat-composer-draft";
import {
  findTextSegment,
  readFileTriggerMatchForDraft,
  readSkillTriggerMatchForDraft,
  readSlashTriggerMatchForDraft,
} from "./agent-chat-composer-draft";
import {
  resolveTextSelectionTarget,
  type TextSelectionTarget,
} from "./use-agent-chat-composer-editor-selection";

export type SlashMenuState = {
  textSegmentId: string;
  query: string;
  rangeStart: number;
  rangeEnd: number;
};

export type FileMenuState = {
  textSegmentId: string;
  query: string;
  rangeStart: number;
  rangeEnd: number;
  results: AgentFileSearchResult[];
  isLoading: boolean;
  error: string | null;
};

export type SkillMenuState = {
  textSegmentId: string;
  query: string;
  rangeStart: number;
  rangeEnd: number;
};

type AutocompleteAvailabilityContext = {
  disabled: boolean;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  supportsSkillReferences: boolean;
};

type InternalSlashMenuState = SlashMenuState & {
  availabilityContext: AutocompleteAvailabilityContext;
};

type InternalFileMenuState = FileMenuState & {
  availabilityContext: AutocompleteAvailabilityContext;
  requestId: number;
};

type InternalSkillMenuState = SkillMenuState & {
  availabilityContext: AutocompleteAvailabilityContext;
};

export const AUTOCOMPLETE_NAVIGATION_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "Enter",
  "Tab",
  "Escape",
]);

const FILE_SEARCH_FAILED_MESSAGE = "Failed to search files.";

const isSameTextMenuRequest = (
  menuState: { textSegmentId: string; query: string; rangeStart: number; rangeEnd: number } | null,
  segmentId: string,
  match: AgentChatFileTriggerMatch | AgentChatSkillTriggerMatch,
): boolean => {
  if (!menuState) {
    return false;
  }

  return (
    menuState.textSegmentId === segmentId &&
    menuState.query === match.query &&
    menuState.rangeStart === match.rangeStart &&
    menuState.rangeEnd === match.rangeEnd
  );
};

const filterSlashCommands = (commands: AgentSlashCommand[], query: string): AgentSlashCommand[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return commands;
  }

  return commands.filter((command) => command.trigger.toLowerCase().includes(normalizedQuery));
};

const filterSkills = (skills: AgentSkillReference[], query: string): AgentSkillReference[] => {
  const normalizedQuery = query.trim().toLowerCase();
  // react-doctor-disable-next-line react-doctor/js-tosorted-immutable -- keep older WebView compatibility.
  const sortedSkills = [...skills].sort((left, right) => {
    const leftLabel = left.displayName ?? left.title ?? left.name;
    const rightLabel = right.displayName ?? right.title ?? right.name;
    return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: "base" });
  });
  if (normalizedQuery.length === 0) {
    return sortedSkills;
  }

  return sortedSkills.filter((skill) =>
    [skill.name, skill.title, skill.displayName]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase().includes(normalizedQuery)),
  );
};

const moveActiveIndex = (
  itemCount: number,
  direction: 1 | -1,
  setIndex: Dispatch<SetStateAction<number>>,
): boolean => {
  if (itemCount === 0) {
    return false;
  }

  setIndex((current) => {
    if (direction > 0) {
      return (current + 1) % itemCount;
    }

    return current === 0 ? itemCount - 1 : current - 1;
  });
  return true;
};

type UseAgentChatComposerEditorAutocompleteArgs = {
  disabled: boolean;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  supportsSkillReferences: boolean;
  slashCommands: AgentSlashCommand[];
  skills: AgentSkillReference[];
  searchFiles: (query: string) => Promise<AgentFileSearchResult[]>;
};

export type UseAgentChatComposerEditorAutocompleteResult = {
  slashMenuState: SlashMenuState | null;
  fileMenuState: FileMenuState | null;
  skillMenuState: SkillMenuState | null;
  filteredSlashCommands: AgentSlashCommand[];
  filteredSkills: AgentSkillReference[];
  activeSlashIndex: number;
  activeSkillIndex: number;
  showSlashMenu: boolean;
  showSkillMenu: boolean;
  fileSearchResults: AgentFileSearchResult[];
  activeFileIndex: number;
  showFileMenu: boolean;
  fileSearchError: string | null;
  isFileSearchLoading: boolean;
  closeSlashMenu: () => void;
  closeFileMenu: () => void;
  closeSkillMenu: () => void;
  syncMenusForSelectionTarget: (
    sourceDraft: AgentChatComposerDraft,
    selectionTarget: TextSelectionTarget | null,
  ) => void;
  moveActiveFileIndex: (direction: 1 | -1) => boolean;
  moveActiveSlashIndex: (direction: 1 | -1) => boolean;
  moveActiveSkillIndex: (direction: 1 | -1) => boolean;
};

export const useAgentChatComposerEditorAutocomplete = ({
  disabled,
  supportsSlashCommands,
  supportsFileSearch,
  supportsSkillReferences,
  slashCommands,
  skills,
  searchFiles,
}: UseAgentChatComposerEditorAutocompleteArgs): UseAgentChatComposerEditorAutocompleteResult => {
  const [slashMenuState, setSlashMenuState] = useState<InternalSlashMenuState | null>(null);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const [skillMenuState, setSkillMenuState] = useState<InternalSkillMenuState | null>(null);
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);
  const [fileMenuState, setFileMenuState] = useState<InternalFileMenuState | null>(null);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const fileSearchRequestIdRef = useRef(0);
  const availabilityContext = useMemo<AutocompleteAvailabilityContext>(
    () => ({
      disabled,
      supportsSlashCommands,
      supportsFileSearch,
      supportsSkillReferences,
    }),
    [disabled, supportsFileSearch, supportsSkillReferences, supportsSlashCommands],
  );

  const effectiveSlashMenuState =
    disabled ||
    !supportsSlashCommands ||
    slashMenuState?.availabilityContext !== availabilityContext
      ? null
      : slashMenuState;
  const effectiveFileMenuState =
    disabled || !supportsFileSearch || fileMenuState?.availabilityContext !== availabilityContext
      ? null
      : fileMenuState;
  const effectiveSkillMenuState =
    disabled ||
    !supportsSkillReferences ||
    skillMenuState?.availabilityContext !== availabilityContext
      ? null
      : skillMenuState;

  const filteredSlashCommands = useMemo(() => {
    if (!effectiveSlashMenuState) {
      return [];
    }
    return filterSlashCommands(slashCommands, effectiveSlashMenuState.query);
  }, [effectiveSlashMenuState, slashCommands]);

  const filteredSkills = useMemo(() => {
    if (!effectiveSkillMenuState) {
      return [];
    }
    return filterSkills(skills, effectiveSkillMenuState.query);
  }, [effectiveSkillMenuState, skills]);

  const closeSlashMenu = useCallback(() => {
    setSlashMenuState(null);
  }, []);

  const closeFileMenu = useCallback(() => {
    fileSearchRequestIdRef.current += 1;
    setActiveFileIndex(0);
    setFileMenuState(null);
  }, []);

  const closeSkillMenu = useCallback(() => {
    setActiveSkillIndex(0);
    setSkillMenuState(null);
  }, []);

  const updateSlashMenuForText = useCallback(
    (
      sourceDraft: AgentChatComposerDraft,
      segmentId: string,
      text: string,
      caretOffset: number | null,
    ) => {
      if (disabled || !supportsSlashCommands || caretOffset === null) {
        setActiveSlashIndex(0);
        setSlashMenuState(null);
        return;
      }

      const match = readSlashTriggerMatchForDraft(sourceDraft, segmentId, caretOffset, text);
      if (!match) {
        setActiveSlashIndex(0);
        setSlashMenuState(null);
        return;
      }

      setActiveSlashIndex(0);
      setSlashMenuState({
        textSegmentId: segmentId,
        query: match.query,
        rangeStart: match.rangeStart,
        rangeEnd: match.rangeEnd,
        availabilityContext,
      });
    },
    [availabilityContext, disabled, supportsSlashCommands],
  );

  const updateFileMenuForText = useCallback(
    (
      sourceDraft: AgentChatComposerDraft,
      segmentId: string,
      text: string,
      caretOffset: number | null,
    ) => {
      if (disabled || !supportsFileSearch || caretOffset === null) {
        closeFileMenu();
        return;
      }

      const match = readFileTriggerMatchForDraft(sourceDraft, segmentId, caretOffset, text);
      if (!match) {
        closeFileMenu();
        return;
      }

      if (isSameTextMenuRequest(effectiveFileMenuState, segmentId, match)) {
        return;
      }

      const requestId = fileSearchRequestIdRef.current + 1;
      const requestAvailabilityContext = availabilityContext;
      fileSearchRequestIdRef.current = requestId;
      setActiveFileIndex(0);
      setFileMenuState((previousState) => ({
        textSegmentId: segmentId,
        query: match.query,
        rangeStart: match.rangeStart,
        rangeEnd: match.rangeEnd,
        results:
          previousState && previousState.textSegmentId === segmentId ? previousState.results : [],
        isLoading: true,
        error: null,
        availabilityContext: requestAvailabilityContext,
        requestId,
      }));

      void searchFiles(match.query)
        .then((results) => {
          if (fileSearchRequestIdRef.current !== requestId) {
            return;
          }
          setFileMenuState({
            textSegmentId: segmentId,
            query: match.query,
            rangeStart: match.rangeStart,
            rangeEnd: match.rangeEnd,
            results,
            isLoading: false,
            error: null,
            availabilityContext: requestAvailabilityContext,
            requestId,
          });
        })
        .catch((error) => {
          if (fileSearchRequestIdRef.current !== requestId) {
            return;
          }
          setFileMenuState((previousState) => ({
            textSegmentId: segmentId,
            query: match.query,
            rangeStart: match.rangeStart,
            rangeEnd: match.rangeEnd,
            results: previousState?.results ?? [],
            isLoading: false,
            error: error instanceof Error ? error.message : FILE_SEARCH_FAILED_MESSAGE,
            availabilityContext: requestAvailabilityContext,
            requestId,
          }));
        });
    },
    [
      availabilityContext,
      closeFileMenu,
      disabled,
      effectiveFileMenuState,
      searchFiles,
      supportsFileSearch,
    ],
  );

  const updateSkillMenuForText = useCallback(
    (
      sourceDraft: AgentChatComposerDraft,
      segmentId: string,
      text: string,
      caretOffset: number | null,
    ) => {
      if (disabled || !supportsSkillReferences || caretOffset === null) {
        closeSkillMenu();
        return;
      }

      const match = readSkillTriggerMatchForDraft(sourceDraft, segmentId, caretOffset, text);
      if (!match) {
        closeSkillMenu();
        return;
      }

      if (isSameTextMenuRequest(effectiveSkillMenuState, segmentId, match)) {
        return;
      }

      setActiveSkillIndex(0);
      setSkillMenuState({
        textSegmentId: segmentId,
        query: match.query,
        rangeStart: match.rangeStart,
        rangeEnd: match.rangeEnd,
        availabilityContext,
      });
    },
    [
      availabilityContext,
      closeSkillMenu,
      disabled,
      effectiveSkillMenuState,
      supportsSkillReferences,
    ],
  );

  const syncMenusForSelectionTarget = useCallback(
    (sourceDraft: AgentChatComposerDraft, selectionTarget: TextSelectionTarget | null) => {
      const resolvedSelectionTarget = resolveTextSelectionTarget(sourceDraft, selectionTarget);
      if (!resolvedSelectionTarget) {
        closeSlashMenu();
        closeFileMenu();
        closeSkillMenu();
        return;
      }

      const segment = findTextSegment(sourceDraft, resolvedSelectionTarget.segmentId);
      if (!segment) {
        closeSlashMenu();
        closeFileMenu();
        closeSkillMenu();
        return;
      }

      updateSlashMenuForText(sourceDraft, segment.id, segment.text, resolvedSelectionTarget.offset);
      updateFileMenuForText(sourceDraft, segment.id, segment.text, resolvedSelectionTarget.offset);
      updateSkillMenuForText(sourceDraft, segment.id, segment.text, resolvedSelectionTarget.offset);
    },
    [
      closeFileMenu,
      closeSkillMenu,
      closeSlashMenu,
      updateFileMenuForText,
      updateSkillMenuForText,
      updateSlashMenuForText,
    ],
  );

  const moveActiveFileIndex = useCallback(
    (direction: 1 | -1) => {
      return moveActiveIndex(
        effectiveFileMenuState?.results.length ?? 0,
        direction,
        setActiveFileIndex,
      );
    },
    [effectiveFileMenuState],
  );

  const moveActiveSlashIndex = useCallback(
    (direction: 1 | -1) => {
      return moveActiveIndex(filteredSlashCommands.length, direction, setActiveSlashIndex);
    },
    [filteredSlashCommands],
  );

  const moveActiveSkillIndex = useCallback(
    (direction: 1 | -1) => {
      return moveActiveIndex(filteredSkills.length, direction, setActiveSkillIndex);
    },
    [filteredSkills],
  );

  return {
    slashMenuState: effectiveSlashMenuState,
    fileMenuState: effectiveFileMenuState,
    skillMenuState: effectiveSkillMenuState,
    filteredSlashCommands,
    filteredSkills,
    activeSlashIndex: effectiveSlashMenuState ? activeSlashIndex : 0,
    activeSkillIndex: effectiveSkillMenuState ? activeSkillIndex : 0,
    showSlashMenu: effectiveSlashMenuState !== null,
    showSkillMenu: effectiveSkillMenuState !== null,
    fileSearchResults: effectiveFileMenuState?.results ?? [],
    activeFileIndex: effectiveFileMenuState ? activeFileIndex : 0,
    showFileMenu: effectiveFileMenuState !== null,
    fileSearchError: effectiveFileMenuState?.error ?? null,
    isFileSearchLoading: effectiveFileMenuState?.isLoading ?? false,
    closeSlashMenu,
    closeFileMenu,
    closeSkillMenu,
    syncMenusForSelectionTarget,
    moveActiveFileIndex,
    moveActiveSlashIndex,
    moveActiveSkillIndex,
  };
};
