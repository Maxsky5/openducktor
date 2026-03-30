import type { AgentFileSearchResult, AgentSlashCommand } from "@openducktor/core";
import {
  type FocusEvent as ReactFocusEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
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
  createTextSegment,
  draftHasMeaningfulContent,
  normalizeComposerDraft,
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
  selectSlashCommand: (command: AgentSlashCommand) => void;
  selectFileSearchResult: (result: AgentFileSearchResult) => void;
  handleEditorInput: (root: HTMLDivElement) => void;
  handleEditorBeforeInput: (event: ReactFormEvent<HTMLDivElement>) => void;
  handleEditorFocus: (event: ReactFocusEvent<HTMLDivElement>) => void;
  handleEditorClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  handleEditorKeyUp: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  handleEditorKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
};

type ActiveTextSelection = {
  segmentId: string;
  element: HTMLElement;
  text: string;
  caretOffset: number | null;
};

const AUTOCOMPLETE_NAVIGATION_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"]);

const filterSlashCommands = (commands: AgentSlashCommand[], query: string): AgentSlashCommand[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return commands;
  }

  return commands.filter((command) => command.trigger.toLowerCase().includes(normalizedQuery));
};

const getComposerContentRoot = (root: HTMLElement): HTMLElement | null => {
  return root.querySelector<HTMLElement>("[data-composer-content-root]");
};

const getClosestTextSegmentElement = (node: Node | null, root: HTMLElement): HTMLElement | null => {
  const element = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  const textSegment = element?.closest<HTMLElement>("[data-text-segment-id]") ?? null;
  if (!textSegment || !root.contains(textSegment)) {
    return null;
  }
  return textSegment;
};

const readActiveTextSelection = (
  root: HTMLElement,
  eventTarget?: EventTarget | null,
): ActiveTextSelection | null => {
  const selection = root.ownerDocument.defaultView?.getSelection() ?? globalThis.getSelection?.();
  if (selection && selection.rangeCount > 0 && selection.isCollapsed) {
    const textSegment = getClosestTextSegmentElement(selection.anchorNode, root);
    if (textSegment) {
      return {
        segmentId: textSegment.dataset.textSegmentId ?? textSegment.dataset.segmentId ?? "",
        element: textSegment,
        text: readEditableTextContent(textSegment),
        caretOffset: getCaretOffsetWithinElement(textSegment),
      };
    }
  }

  if (eventTarget instanceof Node) {
    const textSegment = getClosestTextSegmentElement(eventTarget, root);
    if (textSegment) {
      return {
        segmentId: textSegment.dataset.textSegmentId ?? textSegment.dataset.segmentId ?? "",
        element: textSegment,
        text: readEditableTextContent(textSegment),
        caretOffset: getCaretOffsetWithinElement(textSegment),
      };
    }
  }

  return null;
};

const parseComposerDraftFromRoot = (
  root: HTMLElement,
  previousDraft: AgentChatComposerDraft,
): AgentChatComposerDraft => {
  const contentRoot = getComposerContentRoot(root);
  if (!contentRoot) {
    return previousDraft;
  }

  const previousSegments = new Map(previousDraft.segments.map((segment) => [segment.id, segment]));
  const nextSegments: AgentChatComposerDraft["segments"] = [];

  for (const node of Array.from(contentRoot.childNodes)) {
    if (node instanceof HTMLElement && node.dataset.chipSegmentId) {
      const segmentId = node.dataset.segmentId;
      const previousSegment = segmentId ? previousSegments.get(segmentId) : undefined;
      if (previousSegment && previousSegment.kind !== "text") {
        nextSegments.push(previousSegment);
      }
      continue;
    }

    if (node instanceof HTMLElement && node.dataset.textSegmentId) {
      nextSegments.push(
        createTextSegment(readEditableTextContent(node), node.dataset.textSegmentId),
      );
      continue;
    }

    if (node instanceof Text) {
      if (node.textContent && node.textContent.length > 0) {
        nextSegments.push(createTextSegment(node.textContent));
      }
      continue;
    }

    if (node instanceof HTMLElement) {
      const text = readEditableTextContent(node);
      if (text.length > 0) {
        nextSegments.push(createTextSegment(text));
      }
    }
  }

  return normalizeComposerDraft({
    segments: nextSegments.length > 0 ? nextSegments : [createTextSegment("")],
  });
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

  return {
    registerTextSegmentRef: (segmentId: string, element: HTMLElement | null) => {
      textSegmentRefs.current[segmentId] = element;
    },
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
      focusTextSegment(segmentId, offset);
    },
    [focusTextSegment],
  );

  const focusNearestTextSegment = useCallback(
    (segmentId: string, direction: "left" | "right") => {
      const currentIndex = draft.segments.findIndex((segment) => segment.id === segmentId);
      if (currentIndex < 0) {
        return false;
      }

      const step = direction === "left" ? -1 : 1;
      for (
        let index = currentIndex + step;
        index >= 0 && index < draft.segments.length;
        index += step
      ) {
        const segment = draft.segments[index];
        if (!segment || segment.kind !== "text") {
          continue;
        }

        focusTextSegmentWithMemory(segment.id, direction === "left" ? segment.text.length : 0);
        return true;
      }

      return false;
    },
    [draft.segments, focusTextSegmentWithMemory],
  );

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

  const syncMenusFromRoot = useCallback(
    (
      root: HTMLDivElement,
      sourceDraft: AgentChatComposerDraft,
      eventTarget?: EventTarget | null,
    ) => {
      const activeSelection = readActiveTextSelection(root, eventTarget);
      if (!activeSelection || activeSelection.segmentId.length === 0) {
        setSlashMenuState(null);
        closeFileMenu();
        return;
      }

      updateSlashMenuForText(
        sourceDraft,
        activeSelection.segmentId,
        activeSelection.text,
        activeSelection.caretOffset,
      );
      updateFileMenuForText(
        sourceDraft,
        activeSelection.segmentId,
        activeSelection.text,
        activeSelection.caretOffset,
      );
    },
    [closeFileMenu, updateFileMenuForText, updateSlashMenuForText],
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

  const handleEditorInput = useCallback(
    (root: HTMLDivElement) => {
      const nextDraft = parseComposerDraftFromRoot(root, draft);
      onDraftChange(nextDraft);
      onEditorInput();
      syncMenusFromRoot(root, nextDraft);
    },
    [draft, onDraftChange, onEditorInput, syncMenusFromRoot],
  );

  const handleEditorBeforeInput = useCallback(
    (event: ReactFormEvent<HTMLDivElement>) => {
      const nativeEvent = event.nativeEvent as { inputType?: unknown };
      const inputType = typeof nativeEvent.inputType === "string" ? nativeEvent.inputType : null;
      if (inputType !== "insertLineBreak" && inputType !== "insertParagraph") {
        return;
      }

      setSlashMenuState(null);
      closeFileMenu();
    },
    [closeFileMenu],
  );

  const handleEditorFocus = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>) => {
      syncMenusFromRoot(event.currentTarget, draft, event.target);
    },
    [draft, syncMenusFromRoot],
  );

  const handleEditorClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      syncMenusFromRoot(event.currentTarget, draft, event.target);
    },
    [draft, syncMenusFromRoot],
  );

  const handleEditorKeyUp = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (AUTOCOMPLETE_NAVIGATION_KEYS.has(event.key)) {
        return;
      }
      syncMenusFromRoot(event.currentTarget, draft, event.target);
    },
    [draft, syncMenusFromRoot],
  );

  const handleEditorKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const root = event.currentTarget;
      const activeSelection = readActiveTextSelection(root, event.target);

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

      if (event.key === "Enter" && event.shiftKey) {
        setSlashMenuState(null);
        closeFileMenu();
        return;
      }

      if (!activeSelection) {
        return;
      }

      if (
        event.key === "Backspace" &&
        activeSelection.text.length === 0 &&
        !draftHasMeaningfulContent(draft)
      ) {
        event.preventDefault();
        focusTextSegmentWithMemory(activeSelection.segmentId, 0);
        return;
      }

      if (event.key === "Backspace" && activeSelection.caretOffset === 0) {
        const currentIndex = draft.segments.findIndex(
          (segment) => segment.id === activeSelection.segmentId,
        );
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
      closeFileMenu,
      disabled,
      draft,
      fileMenuState,
      filteredSlashCommands,
      focusTextSegmentWithMemory,
      onSend,
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
    selectSlashCommand,
    selectFileSearchResult,
    handleEditorInput,
    handleEditorBeforeInput,
    handleEditorFocus,
    handleEditorClick,
    handleEditorKeyUp,
    handleEditorKeyDown,
  };
};
