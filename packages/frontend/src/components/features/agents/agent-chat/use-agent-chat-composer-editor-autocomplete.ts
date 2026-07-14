import type {
  AgentFileSearchResult,
  AgentSkillReference,
  AgentSlashCommand,
  AgentSubagentReference,
} from "@openducktor/core";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export type ReferenceMenuState = {
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

export type ReferenceMenuItem =
  | {
      kind: "subagent";
      id: string;
      subagent: AgentSubagentReference;
    }
  | {
      kind: "file";
      id: string;
      result: AgentFileSearchResult;
    };

type AutocompleteAvailabilityContext = {
  disabled: boolean;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  supportsSkillReferences: boolean;
  supportsSubagentReferences: boolean;
};

type InternalSlashMenuState = SlashMenuState & {
  availabilityContext: AutocompleteAvailabilityContext;
};

type InternalReferenceMenuState = ReferenceMenuState & {
  availabilityContext: AutocompleteAvailabilityContext;
  requestId: number;
  showLoadingIndicator: boolean;
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
const FILE_SEARCH_DEBOUNCE_MS = 100;
const FILE_SEARCH_LOADING_INDICATOR_DELAY_MS = 500;

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

const filterSubagents = (
  subagents: AgentSubagentReference[],
  query: string,
): AgentSubagentReference[] => {
  const normalizedQuery = query.trim().toLowerCase();
  // react-doctor-disable-next-line react-doctor/js-tosorted-immutable -- keep older WebView compatibility.
  const sortedSubagents = [...subagents].sort((left, right) => {
    const leftLabel = left.label ?? left.name;
    const rightLabel = right.label ?? right.name;
    return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: "base" });
  });
  if (normalizedQuery.length === 0) {
    return sortedSubagents;
  }

  return sortedSubagents.filter((subagent) =>
    [subagent.name, subagent.label, subagent.description]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase().includes(normalizedQuery)),
  );
};

const buildReferenceMenuItems = (
  subagents: AgentSubagentReference[],
  fileResults: AgentFileSearchResult[],
): ReferenceMenuItem[] => [
  ...subagents.map((subagent) => ({
    kind: "subagent" as const,
    id: `subagent:${subagent.id}`,
    subagent,
  })),
  ...fileResults.map((result) => ({
    kind: "file" as const,
    id: `file:${result.id}`,
    result,
  })),
];

type UseAgentChatComposerEditorAutocompleteArgs = {
  disabled: boolean;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  supportsSkillReferences: boolean;
  supportsSubagentReferences: boolean;
  slashCommands: AgentSlashCommand[];
  skills: AgentSkillReference[];
  subagents: AgentSubagentReference[];
  searchFiles: (query: string) => Promise<AgentFileSearchResult[]>;
};

export type UseAgentChatComposerEditorAutocompleteResult = {
  slashMenuState: SlashMenuState | null;
  referenceMenuState: ReferenceMenuState | null;
  skillMenuState: SkillMenuState | null;
  filteredSlashCommands: AgentSlashCommand[];
  filteredSkills: AgentSkillReference[];
  filteredSubagents: AgentSubagentReference[];
  referenceMenuItems: ReferenceMenuItem[];
  activeSlashIndex: number;
  activeSkillIndex: number;
  showSlashMenu: boolean;
  showSkillMenu: boolean;
  fileSearchResults: AgentFileSearchResult[];
  activeReferenceIndex: number;
  showReferenceMenu: boolean;
  fileSearchError: string | null;
  isFileSearchPending: boolean;
  isFileSearchLoading: boolean;
  closeSlashMenu: () => void;
  closeReferenceMenu: () => void;
  closeSkillMenu: () => void;
  syncMenusForSelectionTarget: (
    sourceDraft: AgentChatComposerDraft,
    selectionTarget: TextSelectionTarget | null,
  ) => void;
  moveActiveReferenceIndex: (direction: 1 | -1) => boolean;
  moveActiveSlashIndex: (direction: 1 | -1) => boolean;
  moveActiveSkillIndex: (direction: 1 | -1) => boolean;
};

export const useAgentChatComposerEditorAutocomplete = ({
  disabled,
  supportsSlashCommands,
  supportsFileSearch,
  supportsSkillReferences,
  supportsSubagentReferences,
  slashCommands,
  skills,
  subagents,
  searchFiles,
}: UseAgentChatComposerEditorAutocompleteArgs): UseAgentChatComposerEditorAutocompleteResult => {
  const [slashMenuState, setSlashMenuState] = useState<InternalSlashMenuState | null>(null);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const [skillMenuState, setSkillMenuState] = useState<InternalSkillMenuState | null>(null);
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);
  const [referenceMenuState, setReferenceMenuState] = useState<InternalReferenceMenuState | null>(
    null,
  );
  const [activeReferenceIndex, setActiveReferenceIndex] = useState(0);
  const fileSearchRequestIdRef = useRef(0);
  const fileSearchDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileSearchLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchFilesRef = useRef(searchFiles);
  useEffect(() => {
    searchFilesRef.current = searchFiles;
  }, [searchFiles]);
  const availabilityContext = useMemo<AutocompleteAvailabilityContext>(
    () => ({
      disabled,
      supportsSlashCommands,
      supportsFileSearch,
      supportsSkillReferences,
      supportsSubagentReferences,
    }),
    [
      disabled,
      supportsFileSearch,
      supportsSkillReferences,
      supportsSlashCommands,
      supportsSubagentReferences,
    ],
  );

  const effectiveSlashMenuState =
    disabled ||
    !supportsSlashCommands ||
    slashMenuState?.availabilityContext !== availabilityContext
      ? null
      : slashMenuState;
  const effectiveReferenceMenuState =
    disabled ||
    (!supportsFileSearch && !supportsSubagentReferences) ||
    referenceMenuState?.availabilityContext !== availabilityContext
      ? null
      : referenceMenuState;
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

  const filteredSubagents = useMemo(() => {
    if (!effectiveReferenceMenuState || !supportsSubagentReferences) {
      return [];
    }
    return filterSubagents(subagents, effectiveReferenceMenuState.query);
  }, [effectiveReferenceMenuState, subagents, supportsSubagentReferences]);

  const referenceMenuItems = useMemo(
    () => buildReferenceMenuItems(filteredSubagents, effectiveReferenceMenuState?.results ?? []),
    [effectiveReferenceMenuState, filteredSubagents],
  );

  const closeSlashMenu = useCallback(() => {
    setSlashMenuState(null);
  }, []);

  const clearFileSearchLoadingTimer = useCallback(() => {
    const timer = fileSearchLoadingTimerRef.current;
    if (timer === null) {
      return;
    }

    clearTimeout(timer);
    fileSearchLoadingTimerRef.current = null;
  }, []);

  const clearFileSearchDebounceTimer = useCallback(() => {
    const timer = fileSearchDebounceTimerRef.current;
    if (timer === null) {
      return;
    }

    clearTimeout(timer);
    fileSearchDebounceTimerRef.current = null;
  }, []);

  const invalidateFileSearchRequest = useCallback(() => {
    fileSearchRequestIdRef.current += 1;
    clearFileSearchDebounceTimer();
    clearFileSearchLoadingTimer();
  }, [clearFileSearchDebounceTimer, clearFileSearchLoadingTimer]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Availability changes must invalidate queued work.
  useEffect(() => invalidateFileSearchRequest, [availabilityContext, invalidateFileSearchRequest]);

  const closeReferenceMenu = useCallback(() => {
    invalidateFileSearchRequest();
    setActiveReferenceIndex(0);
    setReferenceMenuState(null);
  }, [invalidateFileSearchRequest]);

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

  const updateReferenceMenuForText = useCallback(
    (
      sourceDraft: AgentChatComposerDraft,
      segmentId: string,
      text: string,
      caretOffset: number | null,
    ) => {
      if (
        disabled ||
        (!supportsFileSearch && !supportsSubagentReferences) ||
        caretOffset === null
      ) {
        closeReferenceMenu();
        return;
      }

      const match = readFileTriggerMatchForDraft(sourceDraft, segmentId, caretOffset, text);
      if (!match) {
        closeReferenceMenu();
        return;
      }

      if (isSameTextMenuRequest(effectiveReferenceMenuState, segmentId, match)) {
        return;
      }

      const requestAvailabilityContext = availabilityContext;
      invalidateFileSearchRequest();
      const requestId = fileSearchRequestIdRef.current;
      setActiveReferenceIndex(0);
      setReferenceMenuState((previousState) => ({
        textSegmentId: segmentId,
        query: match.query,
        rangeStart: match.rangeStart,
        rangeEnd: match.rangeEnd,
        results:
          previousState &&
          previousState.textSegmentId === segmentId &&
          previousState.availabilityContext === requestAvailabilityContext
            ? previousState.results
            : [],
        isLoading: true,
        showLoadingIndicator: false,
        error: null,
        availabilityContext: requestAvailabilityContext,
        requestId,
      }));

      if (!supportsFileSearch) {
        setReferenceMenuState({
          textSegmentId: segmentId,
          query: match.query,
          rangeStart: match.rangeStart,
          rangeEnd: match.rangeEnd,
          results: [],
          isLoading: false,
          showLoadingIndicator: false,
          error: null,
          availabilityContext: requestAvailabilityContext,
          requestId,
        });
        return;
      }

      fileSearchLoadingTimerRef.current = setTimeout(() => {
        if (fileSearchRequestIdRef.current !== requestId) {
          return;
        }

        setReferenceMenuState((previousState) => {
          if (!previousState || previousState.requestId !== requestId || !previousState.isLoading) {
            return previousState;
          }

          return {
            ...previousState,
            showLoadingIndicator: true,
          };
        });
      }, FILE_SEARCH_LOADING_INDICATOR_DELAY_MS);

      fileSearchDebounceTimerRef.current = setTimeout(() => {
        fileSearchDebounceTimerRef.current = null;
        if (fileSearchRequestIdRef.current !== requestId) {
          return;
        }

        void searchFilesRef
          .current(match.query)
          .then((results) => {
            if (fileSearchRequestIdRef.current !== requestId) {
              return;
            }
            clearFileSearchLoadingTimer();
            setReferenceMenuState({
              textSegmentId: segmentId,
              query: match.query,
              rangeStart: match.rangeStart,
              rangeEnd: match.rangeEnd,
              results,
              isLoading: false,
              showLoadingIndicator: false,
              error: null,
              availabilityContext: requestAvailabilityContext,
              requestId,
            });
          })
          .catch((error) => {
            if (fileSearchRequestIdRef.current !== requestId) {
              return;
            }
            clearFileSearchLoadingTimer();
            setReferenceMenuState((previousState) => ({
              textSegmentId: segmentId,
              query: match.query,
              rangeStart: match.rangeStart,
              rangeEnd: match.rangeEnd,
              results: previousState?.results ?? [],
              isLoading: false,
              showLoadingIndicator: false,
              error: error instanceof Error ? error.message : FILE_SEARCH_FAILED_MESSAGE,
              availabilityContext: requestAvailabilityContext,
              requestId,
            }));
          });
      }, FILE_SEARCH_DEBOUNCE_MS);
    },
    [
      availabilityContext,
      clearFileSearchLoadingTimer,
      closeReferenceMenu,
      disabled,
      effectiveReferenceMenuState,
      invalidateFileSearchRequest,
      supportsFileSearch,
      supportsSubagentReferences,
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
        closeReferenceMenu();
        closeSkillMenu();
        return;
      }

      const segment = findTextSegment(sourceDraft, resolvedSelectionTarget.segmentId);
      if (!segment) {
        closeSlashMenu();
        closeReferenceMenu();
        closeSkillMenu();
        return;
      }

      updateSlashMenuForText(sourceDraft, segment.id, segment.text, resolvedSelectionTarget.offset);
      updateReferenceMenuForText(
        sourceDraft,
        segment.id,
        segment.text,
        resolvedSelectionTarget.offset,
      );
      updateSkillMenuForText(sourceDraft, segment.id, segment.text, resolvedSelectionTarget.offset);
    },
    [
      closeReferenceMenu,
      closeSkillMenu,
      closeSlashMenu,
      updateReferenceMenuForText,
      updateSkillMenuForText,
      updateSlashMenuForText,
    ],
  );

  const moveActiveReferenceIndex = useCallback(
    (direction: 1 | -1) => {
      return moveActiveIndex(referenceMenuItems.length, direction, setActiveReferenceIndex);
    },
    [referenceMenuItems],
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
    referenceMenuState: effectiveReferenceMenuState,
    skillMenuState: effectiveSkillMenuState,
    filteredSlashCommands,
    filteredSkills,
    filteredSubagents,
    referenceMenuItems,
    activeSlashIndex: effectiveSlashMenuState ? activeSlashIndex : 0,
    activeSkillIndex: effectiveSkillMenuState ? activeSkillIndex : 0,
    showSlashMenu: effectiveSlashMenuState !== null,
    showSkillMenu: effectiveSkillMenuState !== null,
    fileSearchResults: effectiveReferenceMenuState?.results ?? [],
    activeReferenceIndex: effectiveReferenceMenuState ? activeReferenceIndex : 0,
    showReferenceMenu: effectiveReferenceMenuState !== null,
    fileSearchError: effectiveReferenceMenuState?.error ?? null,
    isFileSearchPending: effectiveReferenceMenuState?.isLoading ?? false,
    isFileSearchLoading: effectiveReferenceMenuState?.showLoadingIndicator ?? false,
    closeSlashMenu,
    closeReferenceMenu,
    closeSkillMenu,
    syncMenusForSelectionTarget,
    moveActiveReferenceIndex,
    moveActiveSlashIndex,
    moveActiveSkillIndex,
  };
};
