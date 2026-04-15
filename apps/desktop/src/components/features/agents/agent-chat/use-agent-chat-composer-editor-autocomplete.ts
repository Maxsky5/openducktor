import type { AgentFileSearchResult, AgentSlashCommand } from "@openducktor/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentChatComposerDraft } from "./agent-chat-composer-draft";
import {
  readFileTriggerMatchForDraft,
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

export const AUTOCOMPLETE_NAVIGATION_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "Enter",
  "Tab",
  "Escape",
]);

const findTextSegment = (
  draft: AgentChatComposerDraft,
  segmentId: string,
): Extract<AgentChatComposerDraft["segments"][number], { kind: "text" }> | null => {
  for (const segment of draft.segments) {
    if (segment.kind === "text" && segment.id === segmentId) {
      return segment;
    }
  }

  return null;
};

export const filterSlashCommands = (
  commands: AgentSlashCommand[],
  query: string,
): AgentSlashCommand[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return commands;
  }

  return commands.filter((command) => command.trigger.toLowerCase().includes(normalizedQuery));
};

type UseAgentChatComposerEditorAutocompleteArgs = {
  disabled: boolean;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  slashCommands: AgentSlashCommand[];
  searchFiles: (query: string) => Promise<AgentFileSearchResult[]>;
};

export type UseAgentChatComposerEditorAutocompleteResult = {
  slashMenuState: SlashMenuState | null;
  fileMenuState: FileMenuState | null;
  filteredSlashCommands: AgentSlashCommand[];
  activeSlashIndex: number;
  showSlashMenu: boolean;
  fileSearchResults: AgentFileSearchResult[];
  activeFileIndex: number;
  showFileMenu: boolean;
  fileSearchError: string | null;
  isFileSearchLoading: boolean;
  closeSlashMenu: () => void;
  closeFileMenu: () => void;
  syncMenusForSelectionTarget: (
    sourceDraft: AgentChatComposerDraft,
    selectionTarget: TextSelectionTarget | null,
  ) => void;
  moveActiveFileIndex: (direction: 1 | -1) => boolean;
  moveActiveSlashIndex: (direction: 1 | -1) => boolean;
};

export const useAgentChatComposerEditorAutocomplete = ({
  disabled,
  supportsSlashCommands,
  supportsFileSearch,
  slashCommands,
  searchFiles,
}: UseAgentChatComposerEditorAutocompleteArgs): UseAgentChatComposerEditorAutocompleteResult => {
  const [slashMenuState, setSlashMenuState] = useState<SlashMenuState | null>(null);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const [fileMenuState, setFileMenuState] = useState<FileMenuState | null>(null);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const fileSearchRequestIdRef = useRef(0);

  const filteredSlashCommands = useMemo(() => {
    if (!slashMenuState) {
      return [];
    }
    return filterSlashCommands(slashCommands, slashMenuState.query);
  }, [slashCommands, slashMenuState]);

  const closeSlashMenu = useCallback(() => {
    setSlashMenuState(null);
  }, []);

  const closeFileMenu = useCallback(() => {
    fileSearchRequestIdRef.current += 1;
    setActiveFileIndex(0);
    setFileMenuState(null);
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
      });
    },
    [disabled, supportsSlashCommands],
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

      const requestId = fileSearchRequestIdRef.current + 1;
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
            error: error instanceof Error ? error.message : "Failed to search files.",
          }));
        });
    },
    [closeFileMenu, disabled, searchFiles, supportsFileSearch],
  );

  const syncMenusForSelectionTarget = useCallback(
    (sourceDraft: AgentChatComposerDraft, selectionTarget: TextSelectionTarget | null) => {
      const resolvedSelectionTarget = resolveTextSelectionTarget(sourceDraft, selectionTarget);
      if (!resolvedSelectionTarget) {
        closeSlashMenu();
        closeFileMenu();
        return;
      }

      const segment = findTextSegment(sourceDraft, resolvedSelectionTarget.segmentId);
      if (!segment) {
        closeSlashMenu();
        closeFileMenu();
        return;
      }

      updateSlashMenuForText(sourceDraft, segment.id, segment.text, resolvedSelectionTarget.offset);
      updateFileMenuForText(sourceDraft, segment.id, segment.text, resolvedSelectionTarget.offset);
    },
    [closeFileMenu, closeSlashMenu, updateFileMenuForText, updateSlashMenuForText],
  );

  const moveActiveFileIndex = useCallback(
    (direction: 1 | -1) => {
      if (!fileMenuState || fileMenuState.results.length === 0) {
        return false;
      }

      setActiveFileIndex((current) => {
        if (direction > 0) {
          return (current + 1) % fileMenuState.results.length;
        }

        return current === 0 ? fileMenuState.results.length - 1 : current - 1;
      });
      return true;
    },
    [fileMenuState],
  );

  const moveActiveSlashIndex = useCallback(
    (direction: 1 | -1) => {
      if (filteredSlashCommands.length === 0) {
        return false;
      }

      setActiveSlashIndex((current) => {
        if (direction > 0) {
          return (current + 1) % filteredSlashCommands.length;
        }

        return current === 0 ? filteredSlashCommands.length - 1 : current - 1;
      });
      return true;
    },
    [filteredSlashCommands],
  );

  useEffect(() => {
    if (!disabled && supportsSlashCommands) {
      return;
    }
    setSlashMenuState(null);
  }, [disabled, supportsSlashCommands]);

  useEffect(() => {
    if (!disabled && supportsFileSearch) {
      return;
    }
    closeFileMenu();
  }, [closeFileMenu, disabled, supportsFileSearch]);

  return {
    slashMenuState,
    fileMenuState,
    filteredSlashCommands,
    activeSlashIndex,
    showSlashMenu: supportsSlashCommands && slashMenuState !== null,
    fileSearchResults: fileMenuState?.results ?? [],
    activeFileIndex,
    showFileMenu: supportsFileSearch && fileMenuState !== null,
    fileSearchError: fileMenuState?.error ?? null,
    isFileSearchLoading: fileMenuState?.isLoading ?? false,
    closeSlashMenu,
    closeFileMenu,
    syncMenusForSelectionTarget,
    moveActiveFileIndex,
    moveActiveSlashIndex,
  };
};
