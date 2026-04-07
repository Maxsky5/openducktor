import type { AgentFileSearchResult, AgentSlashCommand } from "@openducktor/core";
import {
  type ClipboardEvent as ReactClipboardEvent,
  type FocusEvent as ReactFocusEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
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
  editorRef: RefObject<HTMLDivElement | null>;
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
  focusLastTextSegment: () => void;
  selectSlashCommand: (command: AgentSlashCommand) => void;
  selectFileSearchResult: (result: AgentFileSearchResult) => void;
  handleEditorInput: (root: HTMLDivElement) => void;
  handleEditorBeforeInput: (event: ReactFormEvent<HTMLDivElement>) => void;
  handleEditorPaste: (event: ReactClipboardEvent<HTMLDivElement>) => void;
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

type TextSelectionTarget = {
  segmentId: string;
  offset: number;
};

type PendingInputState = TextSelectionTarget & {
  inputType: string | null;
  data: string | null;
};

const AUTOCOMPLETE_NAVIGATION_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"]);

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

const clampTextSelectionOffset = (text: string, offset: number): number => {
  return Math.max(0, Math.min(offset, text.length));
};

const resolveSelectionTargetFromActiveSelection = (
  draft: AgentChatComposerDraft,
  activeSelection: ActiveTextSelection | null,
): TextSelectionTarget | null => {
  if (!activeSelection) {
    return null;
  }

  return resolveTextSelectionTarget(draft, {
    segmentId: activeSelection.segmentId,
    offset: activeSelection.caretOffset ?? activeSelection.text.length,
  });
};

const resolveTextSelectionTarget = (
  draft: AgentChatComposerDraft,
  selectionTarget: TextSelectionTarget | null,
): TextSelectionTarget | null => {
  if (!selectionTarget || selectionTarget.segmentId.length === 0) {
    return null;
  }

  const segment = findTextSegment(draft, selectionTarget.segmentId);
  if (!segment) {
    return null;
  }

  return {
    segmentId: segment.id,
    offset: clampTextSelectionOffset(segment.text, selectionTarget.offset),
  };
};

const getLastTextSelectionTarget = (draft: AgentChatComposerDraft): TextSelectionTarget | null => {
  for (let index = draft.segments.length - 1; index >= 0; index -= 1) {
    const segment = draft.segments[index];
    if (segment?.kind !== "text") {
      continue;
    }

    return {
      segmentId: segment.id,
      offset: segment.text.length,
    };
  }

  return null;
};

const deriveTextSelectionTargetAfterInput = (
  draft: AgentChatComposerDraft,
  pendingInputState: PendingInputState | null,
  rememberedSelection: TextSelectionTarget | null,
): TextSelectionTarget | null => {
  const rememberedTarget = resolveTextSelectionTarget(
    draft,
    pendingInputState ?? rememberedSelection,
  );
  if (!rememberedTarget) {
    return getLastTextSelectionTarget(draft);
  }

  if (!pendingInputState) {
    return rememberedTarget;
  }

  const segment = findTextSegment(draft, rememberedTarget.segmentId);
  if (!segment) {
    return getLastTextSelectionTarget(draft);
  }

  const { inputType, data } = pendingInputState;
  if (inputType === "insertLineBreak" || inputType === "insertParagraph") {
    return {
      segmentId: segment.id,
      offset: clampTextSelectionOffset(segment.text, rememberedTarget.offset + 1),
    };
  }

  if (inputType?.startsWith("insert")) {
    const offset =
      typeof data === "string" ? rememberedTarget.offset + data.length : segment.text.length;
    return {
      segmentId: segment.id,
      offset: clampTextSelectionOffset(segment.text, offset),
    };
  }

  if (inputType?.includes("Backward")) {
    return {
      segmentId: segment.id,
      offset: clampTextSelectionOffset(segment.text, rememberedTarget.offset - 1),
    };
  }

  if (inputType?.startsWith("delete")) {
    return {
      segmentId: segment.id,
      offset: clampTextSelectionOffset(segment.text, rememberedTarget.offset),
    };
  }

  return rememberedTarget;
};

const filterSlashCommands = (commands: AgentSlashCommand[], query: string): AgentSlashCommand[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return commands;
  }

  return commands.filter((command) => command.trigger.toLowerCase().includes(normalizedQuery));
};

const getComposerContentRoot = (root: HTMLElement): HTMLElement | null => {
  if (root.hasAttribute("data-composer-content-root")) {
    return root;
  }
  return root.querySelector<HTMLElement>("[data-composer-content-root]");
};

const createCollapsedRangeAtComposerEnd = (root: HTMLElement): Range | null => {
  const contentRoot = getComposerContentRoot(root);
  if (!contentRoot) {
    return null;
  }

  const range = root.ownerDocument.createRange();
  range.selectNodeContents(contentRoot);
  range.collapse(false);
  return range;
};

const replaceComposerSelectionWithText = (root: HTMLDivElement, text: string): boolean => {
  const contentRoot = getComposerContentRoot(root);
  const selection = root.ownerDocument.defaultView?.getSelection() ?? globalThis.getSelection?.();
  if (!contentRoot || !selection) {
    return false;
  }

  let range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const rangeInsideComposer =
    range &&
    (range.commonAncestorContainer === contentRoot ||
      contentRoot.contains(range.commonAncestorContainer));
  if (!rangeInsideComposer) {
    range = createCollapsedRangeAtComposerEnd(root);
    if (!range) {
      return false;
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }

  if (!range) {
    return false;
  }

  range.deleteContents();

  if (text.length === 0) {
    const collapsedRange = root.ownerDocument.createRange();
    collapsedRange.setStart(range.startContainer, range.startOffset);
    collapsedRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(collapsedRange);
    root.focus();
    return true;
  }

  const textNode = root.ownerDocument.createTextNode(text);
  range.insertNode(textNode);

  const collapsedRange = root.ownerDocument.createRange();
  collapsedRange.setStart(textNode, text.length);
  collapsedRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(collapsedRange);
  root.focus();
  return true;
};

const selectComposerContents = (root: HTMLElement): boolean => {
  const contentRoot = getComposerContentRoot(root);
  const selection = root.ownerDocument.defaultView?.getSelection() ?? globalThis.getSelection?.();
  if (!contentRoot || !selection) {
    return false;
  }

  const range = root.ownerDocument.createRange();
  range.selectNodeContents(contentRoot);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
};

const isComposerContentFullySelected = (root: HTMLElement): boolean => {
  const contentRoot = getComposerContentRoot(root);
  const selection = root.ownerDocument.defaultView?.getSelection() ?? globalThis.getSelection?.();
  if (!contentRoot || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false;
  }

  const selectionRange = selection.getRangeAt(0);
  const fullRange = root.ownerDocument.createRange();
  fullRange.selectNodeContents(contentRoot);

  return (
    selectionRange.compareBoundaryPoints(Range.START_TO_START, fullRange) === 0 &&
    selectionRange.compareBoundaryPoints(Range.END_TO_END, fullRange) === 0
  );
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
    attachments: previousDraft.attachments ?? [],
  });
};

const usePendingFocus = (editorRef: RefObject<HTMLDivElement | null>) => {
  const pendingFocusRef = useRef<AgentChatComposerDraftEditResult["focusTarget"]>(null);

  const applyFocusTarget = useCallback(
    (focusTarget: NonNullable<AgentChatComposerDraftEditResult["focusTarget"]>): boolean => {
      const root = editorRef.current;
      const target = root?.querySelector<HTMLElement>(
        `[data-text-segment-id="${CSS.escape(focusTarget.segmentId)}"]`,
      );
      if (!target) {
        return false;
      }

      setCaretOffsetWithinElement(target, focusTarget.offset);
      return true;
    },
    [editorRef],
  );

  useLayoutEffect(() => {
    const pendingFocus = pendingFocusRef.current;
    if (!pendingFocus) {
      return;
    }

    if (applyFocusTarget(pendingFocus)) {
      pendingFocusRef.current = null;
    }

    const requestAnimationFrameFn = globalThis.requestAnimationFrame;
    if (typeof requestAnimationFrameFn !== "function") {
      return;
    }

    const rafId = requestAnimationFrameFn(() => {
      const nextPendingFocus = pendingFocusRef.current ?? pendingFocus;
      if (applyFocusTarget(nextPendingFocus)) {
        pendingFocusRef.current = null;
      }
    });

    return () => {
      const cancelAnimationFrameFn = globalThis.cancelAnimationFrame;
      if (typeof cancelAnimationFrameFn === "function") {
        cancelAnimationFrameFn(rafId);
      }
    };
  });

  return {
    focusTextSegment: (segmentId: string, offset: number): boolean => {
      const root = editorRef.current;
      const target = root?.querySelector<HTMLElement>(
        `[data-text-segment-id="${CSS.escape(segmentId)}"]`,
      );
      if (!target) {
        return false;
      }
      setCaretOffsetWithinElement(target, offset);
      return true;
    },
    setPendingFocusTarget: (focusTarget: AgentChatComposerDraftEditResult["focusTarget"]) => {
      pendingFocusRef.current = focusTarget;
    },
  };
};

export const useAgentChatComposerEditor = ({
  draft,
  onDraftChange,
  editorRef,
  disabled,
  onEditorInput,
  onSend,
  supportsSlashCommands,
  supportsFileSearch,
  slashCommands,
  searchFiles,
}: UseAgentChatComposerEditorArgs): UseAgentChatComposerEditorResult => {
  const { focusTextSegment, setPendingFocusTarget } = usePendingFocus(editorRef);
  const [slashMenuState, setSlashMenuState] = useState<SlashMenuState | null>(null);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const [fileMenuState, setFileMenuState] = useState<FileMenuState | null>(null);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const fileSearchRequestIdRef = useRef(0);
  const latestDraftRef = useRef(draft);
  const rememberedSelectionRef = useRef<TextSelectionTarget | null>(null);
  const pendingInputStateRef = useRef<PendingInputState | null>(null);

  latestDraftRef.current = draft;

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

  const rememberSelectionTarget = useCallback(
    (sourceDraft: AgentChatComposerDraft, selectionTarget: TextSelectionTarget | null) => {
      rememberedSelectionRef.current = resolveTextSelectionTarget(sourceDraft, selectionTarget);
    },
    [],
  );

  const getFallbackSelectionTarget = useCallback((sourceDraft: AgentChatComposerDraft) => {
    return (
      resolveTextSelectionTarget(sourceDraft, rememberedSelectionRef.current) ??
      getLastTextSelectionTarget(sourceDraft)
    );
  }, []);

  const repairCollapsedSelection = useCallback(
    (root: HTMLDivElement, sourceDraft: AgentChatComposerDraft): ActiveTextSelection | null => {
      const selection =
        root.ownerDocument.defaultView?.getSelection() ?? globalThis.getSelection?.();
      if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        return null;
      }

      const fallbackTarget = getFallbackSelectionTarget(sourceDraft);
      if (!fallbackTarget) {
        return null;
      }

      const didFocus = focusTextSegment(fallbackTarget.segmentId, fallbackTarget.offset);
      if (!didFocus) {
        setPendingFocusTarget(fallbackTarget);
        return null;
      }

      rememberSelectionTarget(sourceDraft, fallbackTarget);
      const repairedElement = root.querySelector<HTMLElement>(
        `[data-text-segment-id="${CSS.escape(fallbackTarget.segmentId)}"]`,
      );
      if (!repairedElement) {
        return null;
      }

      return {
        segmentId: fallbackTarget.segmentId,
        element: repairedElement,
        text: readEditableTextContent(repairedElement),
        caretOffset: fallbackTarget.offset,
      };
    },
    [focusTextSegment, getFallbackSelectionTarget, rememberSelectionTarget, setPendingFocusTarget],
  );

  const resolveActiveTextSelection = useCallback(
    (
      root: HTMLDivElement,
      sourceDraft: AgentChatComposerDraft,
      eventTarget?: EventTarget | null,
    ) => {
      return (
        readActiveTextSelection(root, eventTarget) ?? repairCollapsedSelection(root, sourceDraft)
      );
    },
    [repairCollapsedSelection],
  );

  const focusTextSegmentWithMemory = useCallback(
    (
      segmentId: string,
      offset: number,
      sourceDraft: AgentChatComposerDraft = latestDraftRef.current,
    ) => {
      const selectionTarget = resolveTextSelectionTarget(sourceDraft, { segmentId, offset });
      if (!selectionTarget) {
        return false;
      }

      rememberSelectionTarget(sourceDraft, selectionTarget);
      const didFocus = focusTextSegment(selectionTarget.segmentId, selectionTarget.offset);
      if (!didFocus) {
        setPendingFocusTarget(selectionTarget);
      }
      return didFocus;
    },
    [focusTextSegment, rememberSelectionTarget, setPendingFocusTarget],
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

  const syncMenusForSelectionTarget = useCallback(
    (sourceDraft: AgentChatComposerDraft, selectionTarget: TextSelectionTarget | null) => {
      const resolvedSelectionTarget = resolveTextSelectionTarget(sourceDraft, selectionTarget);
      if (!resolvedSelectionTarget) {
        setSlashMenuState(null);
        closeFileMenu();
        return;
      }

      const segment = findTextSegment(sourceDraft, resolvedSelectionTarget.segmentId);
      if (!segment) {
        setSlashMenuState(null);
        closeFileMenu();
        return;
      }

      updateSlashMenuForText(sourceDraft, segment.id, segment.text, resolvedSelectionTarget.offset);
      updateFileMenuForText(sourceDraft, segment.id, segment.text, resolvedSelectionTarget.offset);
    },
    [closeFileMenu, updateFileMenuForText, updateSlashMenuForText],
  );

  const syncMenusFromRoot = useCallback(
    (
      root: HTMLDivElement,
      sourceDraft: AgentChatComposerDraft,
      eventTarget?: EventTarget | null,
    ) => {
      const activeSelection = resolveActiveTextSelection(root, sourceDraft, eventTarget);
      const selectionTarget = resolveSelectionTargetFromActiveSelection(
        sourceDraft,
        activeSelection,
      );
      rememberSelectionTarget(sourceDraft, selectionTarget);
      syncMenusForSelectionTarget(sourceDraft, selectionTarget);
    },
    [rememberSelectionTarget, resolveActiveTextSelection, syncMenusForSelectionTarget],
  );

  const resolveSelectionTargetForLineBreak = useCallback(
    (
      root: HTMLDivElement,
      sourceDraft: AgentChatComposerDraft,
      activeSelection: ActiveTextSelection | null,
    ): TextSelectionTarget | null => {
      const resolvedActiveSelection =
        activeSelection ?? resolveActiveTextSelection(root, sourceDraft);
      return (
        resolveSelectionTargetFromActiveSelection(sourceDraft, resolvedActiveSelection) ??
        getFallbackSelectionTarget(sourceDraft)
      );
    },
    [getFallbackSelectionTarget, resolveActiveTextSelection],
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

      pendingInputStateRef.current = null;
      latestDraftRef.current = result.draft;
      rememberSelectionTarget(result.draft, result.focusTarget);

      flushSync(() => {
        onDraftChange(result.draft);
        onEditorInput();
      });

      if (result.focusTarget) {
        const didFocus = focusTextSegment(result.focusTarget.segmentId, result.focusTarget.offset);
        setPendingFocusTarget(didFocus ? null : result.focusTarget);
      } else {
        setPendingFocusTarget(null);
      }
      return true;
    },
    [
      focusTextSegment,
      onDraftChange,
      onEditorInput,
      rememberSelectionTarget,
      setPendingFocusTarget,
    ],
  );

  const insertNewlineAtSelectionTarget = useCallback(
    (selectionTarget: TextSelectionTarget | null) => {
      const resolvedSelectionTarget = resolveTextSelectionTarget(
        latestDraftRef.current,
        selectionTarget ?? rememberedSelectionRef.current,
      );
      if (!resolvedSelectionTarget) {
        return false;
      }

      const didApply = applyEditResult(
        applyComposerDraftEdit(latestDraftRef.current, {
          type: "insert_newline",
          segmentId: resolvedSelectionTarget.segmentId,
          caretOffset: resolvedSelectionTarget.offset,
        }),
      );
      if (!didApply) {
        return false;
      }

      setSlashMenuState(null);
      closeFileMenu();
      return true;
    },
    [applyEditResult, closeFileMenu],
  );

  const clearComposerContents = useCallback(() => {
    const nextDraft = normalizeComposerDraft({
      segments: [createTextSegment("")],
      attachments: latestDraftRef.current.attachments ?? [],
    });
    const firstSegment = nextDraft.segments[0];
    if (!firstSegment || firstSegment.kind !== "text") {
      return false;
    }

    const didApply = applyEditResult({
      draft: nextDraft,
      focusTarget: {
        segmentId: firstSegment.id,
        offset: 0,
      },
    });
    if (!didApply) {
      return false;
    }

    setSlashMenuState(null);
    closeFileMenu();
    return true;
  }, [applyEditResult, closeFileMenu]);

  const selectSlashCommand = useCallback(
    (command: AgentSlashCommand) => {
      if (!slashMenuState) {
        return;
      }

      const sourceDraft = latestDraftRef.current;

      const didApply = applyEditResult(
        applyComposerDraftEdit(sourceDraft, {
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
    [applyEditResult, slashMenuState],
  );

  const selectFileSearchResult = useCallback(
    (result: AgentFileSearchResult) => {
      if (!fileMenuState) {
        return;
      }

      const sourceDraft = latestDraftRef.current;

      const didApply = applyEditResult(
        applyComposerDraftEdit(sourceDraft, {
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
    [applyEditResult, closeFileMenu, fileMenuState],
  );

  const handleEditorInput = useCallback(
    (root: HTMLDivElement) => {
      const activeSelection = readActiveTextSelection(root);
      const nextDraft = parseComposerDraftFromRoot(root, latestDraftRef.current);
      const activeSelectionTarget = resolveSelectionTargetFromActiveSelection(
        nextDraft,
        activeSelection,
      );
      const nextSelectionTarget =
        activeSelectionTarget ??
        deriveTextSelectionTargetAfterInput(
          nextDraft,
          pendingInputStateRef.current,
          rememberedSelectionRef.current,
        );

      rememberSelectionTarget(nextDraft, nextSelectionTarget);
      latestDraftRef.current = nextDraft;
      if (activeSelectionTarget) {
        setPendingFocusTarget(null);
      } else if (nextSelectionTarget) {
        const didFocusSelectionTarget = focusTextSegment(
          nextSelectionTarget.segmentId,
          nextSelectionTarget.offset,
        );
        setPendingFocusTarget(didFocusSelectionTarget ? null : nextSelectionTarget);
      } else {
        setPendingFocusTarget(null);
      }
      pendingInputStateRef.current = null;
      onDraftChange(nextDraft);
      onEditorInput();
      syncMenusForSelectionTarget(nextDraft, nextSelectionTarget);
    },
    [
      focusTextSegment,
      onDraftChange,
      onEditorInput,
      rememberSelectionTarget,
      setPendingFocusTarget,
      syncMenusForSelectionTarget,
    ],
  );

  const handleEditorPaste = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();

      const sourceDraft = latestDraftRef.current;
      const activeSelection = readActiveTextSelection(event.currentTarget, event.target);
      const selectionTarget = resolveSelectionTargetFromActiveSelection(
        sourceDraft,
        activeSelection,
      );
      rememberSelectionTarget(sourceDraft, selectionTarget);
      pendingInputStateRef.current = selectionTarget
        ? {
            ...selectionTarget,
            inputType: "insertFromPaste",
            data: event.clipboardData.getData("text/plain"),
          }
        : null;

      if (
        !replaceComposerSelectionWithText(
          event.currentTarget,
          event.clipboardData.getData("text/plain"),
        )
      ) {
        return;
      }

      setSlashMenuState(null);
      closeFileMenu();
      handleEditorInput(event.currentTarget);
    },
    [closeFileMenu, handleEditorInput, rememberSelectionTarget],
  );

  const handleEditorBeforeInput = useCallback(
    (event: ReactFormEvent<HTMLDivElement>) => {
      const sourceDraft = latestDraftRef.current;
      const activeSelection = resolveActiveTextSelection(
        event.currentTarget,
        sourceDraft,
        event.target,
      );
      const nativeEvent = event.nativeEvent as { inputType?: unknown; data?: unknown };
      const inputType = typeof nativeEvent.inputType === "string" ? nativeEvent.inputType : null;
      const data = typeof nativeEvent.data === "string" ? nativeEvent.data : null;
      const selectionTarget = resolveSelectionTargetFromActiveSelection(
        sourceDraft,
        activeSelection,
      );
      if (selectionTarget) {
        rememberSelectionTarget(sourceDraft, selectionTarget);
        pendingInputStateRef.current = selectionTarget
          ? {
              ...selectionTarget,
              inputType,
              data,
            }
          : null;
      } else {
        pendingInputStateRef.current = null;
      }

      if (inputType !== "insertLineBreak" && inputType !== "insertParagraph") {
        if (
          (inputType === "deleteContentBackward" ||
            inputType === "deleteContentForward" ||
            inputType === "deleteByCut") &&
          isComposerContentFullySelected(event.currentTarget)
        ) {
          event.preventDefault();
          void clearComposerContents();
        }
        return;
      }

      event.preventDefault();
      setSlashMenuState(null);
      closeFileMenu();

      void insertNewlineAtSelectionTarget(
        resolveSelectionTargetForLineBreak(event.currentTarget, sourceDraft, activeSelection),
      );
    },
    [
      clearComposerContents,
      closeFileMenu,
      insertNewlineAtSelectionTarget,
      rememberSelectionTarget,
      resolveActiveTextSelection,
      resolveSelectionTargetForLineBreak,
    ],
  );

  const handleEditorFocus = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>) => {
      syncMenusFromRoot(event.currentTarget, latestDraftRef.current, event.target);
    },
    [syncMenusFromRoot],
  );

  const handleEditorClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      syncMenusFromRoot(event.currentTarget, latestDraftRef.current, event.target);
    },
    [syncMenusFromRoot],
  );

  const handleEditorKeyUp = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (AUTOCOMPLETE_NAVIGATION_KEYS.has(event.key)) {
        return;
      }

      const sourceDraft = latestDraftRef.current;
      const activeSelection = readActiveTextSelection(event.currentTarget, event.target);
      const selectionTarget =
        resolveSelectionTargetFromActiveSelection(sourceDraft, activeSelection) ??
        resolveTextSelectionTarget(sourceDraft, rememberedSelectionRef.current);

      rememberSelectionTarget(sourceDraft, selectionTarget);
      syncMenusForSelectionTarget(sourceDraft, selectionTarget);
    },
    [rememberSelectionTarget, syncMenusForSelectionTarget],
  );

  const handleEditorKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const sourceDraft = latestDraftRef.current;
      const root = event.currentTarget;
      const activeSelection = readActiveTextSelection(root, event.target);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        if (selectComposerContents(root)) {
          event.preventDefault();
        }
        return;
      }

      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        isComposerContentFullySelected(root)
      ) {
        event.preventDefault();
        void clearComposerContents();
        return;
      }

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
        if (!disabled && draftHasMeaningfulContent(sourceDraft)) {
          onSend();
        }
        return;
      }

      if (event.key === "Enter" && event.shiftKey) {
        event.preventDefault();
        void insertNewlineAtSelectionTarget(
          resolveSelectionTargetForLineBreak(root, sourceDraft, activeSelection),
        );
        return;
      }

      const repairedSelection = activeSelection ?? resolveActiveTextSelection(root, sourceDraft);
      if (!repairedSelection) {
        return;
      }

      if (
        event.key === "Backspace" &&
        repairedSelection.text.length === 0 &&
        !draftHasMeaningfulContent(sourceDraft)
      ) {
        event.preventDefault();
        focusTextSegmentWithMemory(repairedSelection.segmentId, 0);
        return;
      }

      if (event.key === "Backspace" && repairedSelection.caretOffset === 0) {
        const currentIndex = sourceDraft.segments.findIndex(
          (segment) => segment.id === repairedSelection.segmentId,
        );
        const previousSegment = currentIndex > 0 ? sourceDraft.segments[currentIndex - 1] : null;
        if (
          previousSegment?.kind === "slash_command" ||
          previousSegment?.kind === "file_reference"
        ) {
          event.preventDefault();
          const didApply = applyEditResult(
            applyComposerDraftEdit(sourceDraft, {
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
      clearComposerContents,
      disabled,
      fileMenuState,
      filteredSlashCommands,
      focusTextSegmentWithMemory,
      insertNewlineAtSelectionTarget,
      onSend,
      resolveActiveTextSelection,
      resolveSelectionTargetForLineBreak,
      selectFileSearchResult,
      selectSlashCommand,
      slashMenuState,
    ],
  );

  const focusLastTextSegment = useCallback(() => {
    const sourceDraft = latestDraftRef.current;
    for (let index = sourceDraft.segments.length - 1; index >= 0; index -= 1) {
      const segment = sourceDraft.segments[index];
      if (!segment || segment.kind !== "text") {
        continue;
      }
      focusTextSegmentWithMemory(segment.id, segment.text.length);
      return;
    }
  }, [focusTextSegmentWithMemory]);

  return {
    filteredSlashCommands,
    activeSlashIndex,
    showSlashMenu: supportsSlashCommands && slashMenuState !== null,
    fileSearchResults: fileMenuState?.results ?? [],
    activeFileIndex,
    showFileMenu: supportsFileSearch && fileMenuState !== null,
    fileSearchError: fileMenuState?.error ?? null,
    isFileSearchLoading: fileMenuState?.isLoading ?? false,
    focusLastTextSegment,
    selectSlashCommand,
    selectFileSearchResult,
    handleEditorInput,
    handleEditorBeforeInput,
    handleEditorPaste,
    handleEditorFocus,
    handleEditorClick,
    handleEditorKeyUp,
    handleEditorKeyDown,
  };
};
