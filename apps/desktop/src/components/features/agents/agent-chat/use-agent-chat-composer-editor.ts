import type { AgentFileSearchResult, AgentSlashCommand } from "@openducktor/core";
import {
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type AgentChatComposerDraft,
  type AgentChatComposerDraftEditResult,
  applyComposerDraftEdit,
  draftHasMeaningfulContent,
  readFileTriggerMatchForDraft,
  readSlashTriggerMatchForDraft,
} from "./agent-chat-composer-draft";
import {
  getCaretOffsetWithinElement,
  readEditableTextContent,
  setCaretOffsetWithinElement,
} from "./agent-chat-composer-selection";

type SlashMenuState = {
  textSegmentId: string;
  query: string;
  rangeStart: number;
  rangeEnd: number;
};

type FileMenuState = {
  textSegmentId: string;
  query: string;
  rangeStart: number;
  rangeEnd: number;
  results: AgentFileSearchResult[];
  isLoading: boolean;
  error: string | null;
};

type UseAgentChatComposerEditorArgs = {
  draft: AgentChatComposerDraft;
  onDraftChange: (draft: AgentChatComposerDraft) => void;
  disabled: boolean;
  onEditorInput: () => void;
  onSend: () => void;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  slashCommands: AgentSlashCommand[];
  searchFiles: (query: string) => Promise<AgentFileSearchResult[]>;
};

type UseAgentChatComposerEditorResult = {
  filteredSlashCommands: AgentSlashCommand[];
  activeSlashIndex: number;
  showSlashMenu: boolean;
  fileSearchResults: AgentFileSearchResult[];
  activeFileIndex: number;
  showFileMenu: boolean;
  fileSearchError: string | null;
  isFileSearchLoading: boolean;
  registerTextSegmentRef: (segmentId: string, element: HTMLElement | null) => void;
  focusLastTextSegment: () => void;
  focusSlashCommandSegment: (segmentId: string) => void;
  focusFileReferenceSegment: (segmentId: string) => void;
  selectSlashCommand: (command: AgentSlashCommand) => void;
  selectFileSearchResult: (result: AgentFileSearchResult) => void;
  handleTextInput: (segmentId: string, element: HTMLElement) => void;
  handleTextBeforeInput: (segmentId: string, event: ReactFormEvent<HTMLElement>) => void;
  handleTextFocus: (segmentId: string, element: HTMLElement) => void;
  handleTextClick: (segmentId: string, element: HTMLElement) => void;
  handleTextKeyUp: (segmentId: string, event: ReactKeyboardEvent<HTMLElement>) => void;
  handleTextKeyDown: (segmentId: string, event: ReactKeyboardEvent<HTMLElement>) => void;
};

const AUTOCOMPLETE_NAVIGATION_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"]);

const filterSlashCommands = (commands: AgentSlashCommand[], query: string): AgentSlashCommand[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return commands;
  }

  return commands.filter((command) => command.trigger.toLowerCase().includes(normalizedQuery));
};

const usePendingFocus = () => {
  const textSegmentRefs = useRef<Record<string, HTMLElement | null>>({});
  const pendingFocusRef = useRef<AgentChatComposerDraftEditResult["focusTarget"]>(null);

  const applyFocusTarget = useCallback(
    (focusTarget: NonNullable<AgentChatComposerDraftEditResult["focusTarget"]>): boolean => {
      const target = textSegmentRefs.current[focusTarget.segmentId];
      if (!target) {
        return false;
      }

      setCaretOffsetWithinElement(target, focusTarget.offset);
      return true;
    },
    [],
  );

  useLayoutEffect(() => {
    const pendingFocus = pendingFocusRef.current;
    if (!pendingFocus) {
      return;
    }

    if (!applyFocusTarget(pendingFocus)) {
      return;
    }
    pendingFocusRef.current = null;

    const requestAnimationFrameFn = globalThis.requestAnimationFrame;
    if (typeof requestAnimationFrameFn !== "function") {
      return;
    }

    const rafId = requestAnimationFrameFn(() => {
      void applyFocusTarget(pendingFocus);
    });

    return () => {
      const cancelAnimationFrameFn = globalThis.cancelAnimationFrame;
      if (typeof cancelAnimationFrameFn === "function") {
        cancelAnimationFrameFn(rafId);
      }
    };
  });

  const registerTextSegmentRef = useCallback((segmentId: string, element: HTMLElement | null) => {
    textSegmentRefs.current[segmentId] = element;
  }, []);

  return {
    registerTextSegmentRef,
    focusTextSegment: (segmentId: string, offset: number) => {
      const target = textSegmentRefs.current[segmentId];
      if (!target) {
        return;
      }
      setCaretOffsetWithinElement(target, offset);
    },
    setPendingFocusTarget: (focusTarget: AgentChatComposerDraftEditResult["focusTarget"]) => {
      pendingFocusRef.current = focusTarget;
    },
  };
};

const useLastKnownCaretOffsets = () => {
  const caretOffsetBySegmentRef = useRef<Record<string, number>>({});

  return {
    rememberCaretOffset: (segmentId: string, caretOffset: number | null) => {
      if (typeof caretOffset !== "number") {
        return;
      }
      caretOffsetBySegmentRef.current[segmentId] = caretOffset;
    },
    readCaretOffset: (segmentId: string): number | null => {
      const caretOffset = caretOffsetBySegmentRef.current[segmentId];
      return typeof caretOffset === "number" ? caretOffset : null;
    },
  };
};

export const useAgentChatComposerEditor = ({
  draft,
  onDraftChange,
  disabled,
  onEditorInput,
  onSend,
  supportsSlashCommands,
  supportsFileSearch,
  slashCommands,
  searchFiles,
}: UseAgentChatComposerEditorArgs): UseAgentChatComposerEditorResult => {
  const { registerTextSegmentRef, focusTextSegment, setPendingFocusTarget } = usePendingFocus();
  const { rememberCaretOffset, readCaretOffset } = useLastKnownCaretOffsets();
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

  const closeFileMenu = useCallback(() => {
    fileSearchRequestIdRef.current += 1;
    setActiveFileIndex(0);
    setFileMenuState(null);
  }, []);

  const focusTextSegmentWithMemory = useCallback(
    (segmentId: string, offset: number) => {
      rememberCaretOffset(segmentId, offset);
      focusTextSegment(segmentId, offset);
    },
    [focusTextSegment, rememberCaretOffset],
  );

  const updateSlashMenuForText = useCallback(
    (segmentId: string, text: string, caretOffset: number | null) => {
      if (disabled || !supportsSlashCommands || caretOffset === null) {
        setActiveSlashIndex(0);
        setSlashMenuState(null);
        return;
      }

      const match = readSlashTriggerMatchForDraft(draft, segmentId, caretOffset, text);
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
    [disabled, draft, supportsSlashCommands],
  );

  const updateFileMenuForText = useCallback(
    (segmentId: string, text: string, caretOffset: number | null) => {
      if (disabled || !supportsFileSearch || caretOffset === null) {
        closeFileMenu();
        return;
      }

      const match = readFileTriggerMatchForDraft(draft, segmentId, caretOffset, text);
      if (!match) {
        closeFileMenu();
        return;
      }

      const requestId = fileSearchRequestIdRef.current + 1;
      fileSearchRequestIdRef.current = requestId;
      setActiveFileIndex(0);
      setFileMenuState({
        textSegmentId: segmentId,
        query: match.query,
        rangeStart: match.rangeStart,
        rangeEnd: match.rangeEnd,
        results: [],
        isLoading: true,
        error: null,
      });

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
          setFileMenuState({
            textSegmentId: segmentId,
            query: match.query,
            rangeStart: match.rangeStart,
            rangeEnd: match.rangeEnd,
            results: [],
            isLoading: false,
            error: error instanceof Error ? error.message : "Failed to search files.",
          });
        });
    },
    [closeFileMenu, disabled, draft, searchFiles, supportsFileSearch],
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

  const applyEditResult = useCallback(
    (result: AgentChatComposerDraftEditResult | null) => {
      if (!result) {
        return false;
      }
      setPendingFocusTarget(result.focusTarget);
      onDraftChange(result.draft);
      onEditorInput();
      return true;
    },
    [onDraftChange, onEditorInput, setPendingFocusTarget],
  );

  const selectSlashCommand = useCallback(
    (command: AgentSlashCommand) => {
      if (!slashMenuState) {
        return;
      }

      const didApply = applyEditResult(
        applyComposerDraftEdit(draft, {
          type: "insert_slash_command",
          textSegmentId: slashMenuState.textSegmentId,
          rangeStart: slashMenuState.rangeStart,
          rangeEnd: slashMenuState.rangeEnd,
          command,
        }),
      );
      if (didApply) {
        setSlashMenuState(null);
      }
    },
    [applyEditResult, draft, slashMenuState],
  );

  const selectFileSearchResult = useCallback(
    (result: AgentFileSearchResult) => {
      if (!fileMenuState) {
        return;
      }

      const didApply = applyEditResult(
        applyComposerDraftEdit(draft, {
          type: "insert_file_reference",
          textSegmentId: fileMenuState.textSegmentId,
          rangeStart: fileMenuState.rangeStart,
          rangeEnd: fileMenuState.rangeEnd,
          file: result,
        }),
      );
      if (didApply) {
        closeFileMenu();
      }
    },
    [applyEditResult, closeFileMenu, draft, fileMenuState],
  );

  const syncSlashMenuFromElement = useCallback(
    (segmentId: string, element: HTMLElement) => {
      const caretOffset = getCaretOffsetWithinElement(element);
      rememberCaretOffset(segmentId, caretOffset);
      updateSlashMenuForText(segmentId, readEditableTextContent(element), caretOffset);
      updateFileMenuForText(segmentId, readEditableTextContent(element), caretOffset);
    },
    [rememberCaretOffset, updateFileMenuForText, updateSlashMenuForText],
  );

  const handleTextInput = useCallback(
    (segmentId: string, element: HTMLElement) => {
      const nextText = readEditableTextContent(element);
      const caretOffset = getCaretOffsetWithinElement(element);
      rememberCaretOffset(segmentId, caretOffset);
      applyEditResult(
        applyComposerDraftEdit(draft, {
          type: "update_text",
          segmentId,
          text: nextText,
          caretOffset,
        }),
      );
      updateSlashMenuForText(segmentId, nextText, caretOffset);
      updateFileMenuForText(segmentId, nextText, caretOffset);
    },
    [applyEditResult, draft, rememberCaretOffset, updateFileMenuForText, updateSlashMenuForText],
  );

  const handleTextBeforeInput = useCallback(
    (segmentId: string, event: ReactFormEvent<HTMLElement>) => {
      const nativeEvent = event.nativeEvent as { inputType?: unknown };
      const inputType = typeof nativeEvent.inputType === "string" ? nativeEvent.inputType : null;
      if (!inputType) {
        return;
      }

      const shouldInsertLineBreak =
        inputType === "insertLineBreak" || inputType === "insertParagraph";
      if (!shouldInsertLineBreak) {
        return;
      }

      const caretOffset =
        getCaretOffsetWithinElement(event.currentTarget) ?? readCaretOffset(segmentId);
      if (caretOffset === null) {
        return;
      }
      rememberCaretOffset(segmentId, caretOffset);
      setSlashMenuState(null);
      closeFileMenu();
    },
    [closeFileMenu, readCaretOffset, rememberCaretOffset],
  );

  const handleTextKeyUp = useCallback(
    (segmentId: string, event: ReactKeyboardEvent<HTMLElement>) => {
      if (AUTOCOMPLETE_NAVIGATION_KEYS.has(event.key)) {
        return;
      }
      syncSlashMenuFromElement(segmentId, event.currentTarget);
    },
    [syncSlashMenuFromElement],
  );

  const handleTextKeyDown = useCallback(
    (segmentId: string, event: ReactKeyboardEvent<HTMLElement>) => {
      const target = event.currentTarget;
      const caretOffset = getCaretOffsetWithinElement(target) ?? readCaretOffset(segmentId);
      rememberCaretOffset(segmentId, caretOffset);

      if (fileMenuState) {
        if (fileMenuState.results.length > 0 && event.key === "ArrowDown") {
          event.preventDefault();
          setActiveFileIndex((current) => (current + 1) % fileMenuState.results.length);
          return;
        }
        if (fileMenuState.results.length > 0 && event.key === "ArrowUp") {
          event.preventDefault();
          setActiveFileIndex((current) =>
            current === 0 ? fileMenuState.results.length - 1 : current - 1,
          );
          return;
        }
        if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
          event.preventDefault();
          const result = fileMenuState.results[activeFileIndex] ?? fileMenuState.results[0];
          if (result) {
            selectFileSearchResult(result);
          }
          return;
        }
      }

      if (slashMenuState) {
        if (filteredSlashCommands.length > 0 && event.key === "ArrowDown") {
          event.preventDefault();
          setActiveSlashIndex((current) => (current + 1) % filteredSlashCommands.length);
          return;
        }
        if (filteredSlashCommands.length > 0 && event.key === "ArrowUp") {
          event.preventDefault();
          setActiveSlashIndex((current) =>
            current === 0 ? filteredSlashCommands.length - 1 : current - 1,
          );
          return;
        }
        if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
          event.preventDefault();
          const command = filteredSlashCommands[activeSlashIndex] ?? filteredSlashCommands[0];
          if (command) {
            selectSlashCommand(command);
          }
          return;
        }
      }

      if (event.key === "Escape" && fileMenuState) {
        event.preventDefault();
        closeFileMenu();
        return;
      }

      if (event.key === "Escape" && slashMenuState) {
        event.preventDefault();
        setSlashMenuState(null);
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (!disabled && draftHasMeaningfulContent(draft)) {
          onSend();
        }
        return;
      }

      if (event.key === "Enter" && event.shiftKey && caretOffset !== null) {
        rememberCaretOffset(segmentId, caretOffset);
        setSlashMenuState(null);
        closeFileMenu();
        return;
      }

      if (event.key === "Backspace") {
        const currentText = readEditableTextContent(target);
        if (currentText.length === 0 && !draftHasMeaningfulContent(draft)) {
          event.preventDefault();
          focusTextSegmentWithMemory(segmentId, 0);
          return;
        }
      }

      if (event.key === "Backspace" && caretOffset === 0) {
        const currentIndex = draft.segments.findIndex((segment) => segment.id === segmentId);
        const previousSegment = currentIndex > 0 ? draft.segments[currentIndex - 1] : null;
        if (
          previousSegment?.kind === "slash_command" ||
          previousSegment?.kind === "file_reference"
        ) {
          event.preventDefault();
          const didApply = applyEditResult(
            applyComposerDraftEdit(draft, {
              type:
                previousSegment.kind === "slash_command"
                  ? "remove_slash_command"
                  : "remove_file_reference",
              segmentId: previousSegment.id,
            }),
          );
          if (didApply) {
            setSlashMenuState(null);
            closeFileMenu();
          }
        }
      }
    },
    [
      activeFileIndex,
      activeSlashIndex,
      applyEditResult,
      disabled,
      draft,
      filteredSlashCommands,
      fileMenuState,
      focusTextSegmentWithMemory,
      onSend,
      closeFileMenu,
      readCaretOffset,
      rememberCaretOffset,
      selectFileSearchResult,
      selectSlashCommand,
      slashMenuState,
    ],
  );

  const focusLastTextSegment = useCallback(() => {
    for (let index = draft.segments.length - 1; index >= 0; index -= 1) {
      const segment = draft.segments[index];
      if (!segment || segment.kind !== "text") {
        continue;
      }
      focusTextSegmentWithMemory(segment.id, segment.text.length);
      return;
    }
  }, [draft.segments, focusTextSegmentWithMemory]);

  const focusSlashCommandSegment = useCallback(
    (segmentId: string) => {
      const currentIndex = draft.segments.findIndex((segment) => segment.id === segmentId);
      if (currentIndex < 0) {
        return;
      }

      const nextSegment = draft.segments[currentIndex + 1];
      if (nextSegment?.kind === "text") {
        focusTextSegmentWithMemory(nextSegment.id, 0);
        return;
      }

      const previousSegment = draft.segments[currentIndex - 1];
      if (previousSegment?.kind === "text") {
        focusTextSegmentWithMemory(previousSegment.id, previousSegment.text.length);
      }
    },
    [draft.segments, focusTextSegmentWithMemory],
  );

  const focusFileReferenceSegment = useCallback(
    (segmentId: string) => {
      const currentIndex = draft.segments.findIndex((segment) => segment.id === segmentId);
      if (currentIndex < 0) {
        return;
      }

      const nextSegment = draft.segments[currentIndex + 1];
      if (nextSegment?.kind === "text") {
        focusTextSegmentWithMemory(nextSegment.id, 0);
        return;
      }

      const previousSegment = draft.segments[currentIndex - 1];
      if (previousSegment?.kind === "text") {
        focusTextSegmentWithMemory(previousSegment.id, previousSegment.text.length);
      }
    },
    [draft.segments, focusTextSegmentWithMemory],
  );

  return {
    filteredSlashCommands,
    activeSlashIndex,
    showSlashMenu: supportsSlashCommands && slashMenuState !== null,
    fileSearchResults: fileMenuState?.results ?? [],
    activeFileIndex,
    showFileMenu: supportsFileSearch && fileMenuState !== null,
    fileSearchError: fileMenuState?.error ?? null,
    isFileSearchLoading: fileMenuState?.isLoading ?? false,
    registerTextSegmentRef,
    focusLastTextSegment,
    focusSlashCommandSegment,
    focusFileReferenceSegment,
    selectSlashCommand,
    selectFileSearchResult,
    handleTextInput,
    handleTextBeforeInput,
    handleTextFocus: syncSlashMenuFromElement,
    handleTextClick: syncSlashMenuFromElement,
    handleTextKeyUp,
    handleTextKeyDown,
  };
};
