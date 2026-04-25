import type { AgentFileSearchResult, AgentSlashCommand } from "@openducktor/core";
import {
  type ClipboardEvent as ReactClipboardEvent,
  type FocusEvent as ReactFocusEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useRef,
} from "react";
import { flushSync } from "react-dom";
import {
  type AgentChatComposerDraft,
  applyComposerDraftEdit,
  createTextSegment,
  normalizeComposerDraft,
} from "./agent-chat-composer-draft";
import { useAgentChatComposerEditorAutocomplete } from "./use-agent-chat-composer-editor-autocomplete";
import { useAgentChatComposerEditorEvents } from "./use-agent-chat-composer-editor-events";
import {
  resolveTextSelectionTarget,
  type TextSelectionTarget,
  useAgentChatComposerEditorSelection,
} from "./use-agent-chat-composer-editor-selection";

type UseAgentChatComposerEditorArgs = {
  draft: AgentChatComposerDraft;
  onDraftChange: (draft: AgentChatComposerDraft) => void;
  onAddFiles: (files: File[]) => void;
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

export const useAgentChatComposerEditor = ({
  draft,
  onDraftChange,
  onAddFiles,
  editorRef,
  disabled,
  onEditorInput,
  onSend,
  supportsSlashCommands,
  supportsFileSearch,
  slashCommands,
  searchFiles,
}: UseAgentChatComposerEditorArgs): UseAgentChatComposerEditorResult => {
  const latestDraftRef = useRef(draft);

  latestDraftRef.current = draft;

  const selection = useAgentChatComposerEditorSelection({ editorRef });
  const {
    rememberSelectionTarget,
    getRememberedSelectionTarget,
    clearPendingInputState,
    focusTextSegment,
    setPendingFocusTarget,
    focusLastTextSegment: focusLastTextSegmentFromSelection,
  } = selection;
  const autocomplete = useAgentChatComposerEditorAutocomplete({
    disabled,
    supportsSlashCommands,
    supportsFileSearch,
    slashCommands,
    searchFiles,
  });
  const {
    slashMenuState,
    fileMenuState,
    filteredSlashCommands,
    activeSlashIndex,
    activeFileIndex,
    showSlashMenu,
    fileSearchResults,
    showFileMenu,
    fileSearchError,
    isFileSearchLoading,
    closeSlashMenu,
    closeFileMenu,
    syncMenusForSelectionTarget,
    moveActiveFileIndex,
    moveActiveSlashIndex,
  } = autocomplete;

  const applyEditResult = useCallback(
    (result: ReturnType<typeof applyComposerDraftEdit>) => {
      if (!result) {
        return false;
      }

      clearPendingInputState();
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
      clearPendingInputState,
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
        selectionTarget ?? getRememberedSelectionTarget(),
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

      closeSlashMenu();
      closeFileMenu();
      return true;
    },
    [applyEditResult, closeFileMenu, closeSlashMenu, getRememberedSelectionTarget],
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

    closeSlashMenu();
    closeFileMenu();
    return true;
  }, [applyEditResult, closeFileMenu, closeSlashMenu]);

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
        closeSlashMenu();
      }
    },
    [applyEditResult, closeSlashMenu, slashMenuState],
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

  const {
    handleEditorInput,
    handleEditorBeforeInput,
    handleEditorPaste,
    handleEditorFocus,
    handleEditorClick,
    handleEditorKeyUp,
    handleEditorKeyDown,
  } = useAgentChatComposerEditorEvents({
    disabled,
    onDraftChange,
    onEditorInput,
    onAddFiles,
    onSend,
    latestDraftRef,
    selection,
    slashMenuState,
    fileMenuState,
    filteredSlashCommands,
    activeSlashIndex,
    activeFileIndex,
    closeSlashMenu,
    closeFileMenu,
    syncMenusForSelectionTarget,
    moveActiveFileIndex,
    moveActiveSlashIndex,
    applyEditResult,
    clearComposerContents,
    insertNewlineAtSelectionTarget,
    selectSlashCommand,
    selectFileSearchResult,
  });

  const focusLastTextSegment = useCallback(() => {
    focusLastTextSegmentFromSelection(latestDraftRef.current);
  }, [focusLastTextSegmentFromSelection]);

  return {
    filteredSlashCommands,
    activeSlashIndex,
    showSlashMenu,
    fileSearchResults,
    activeFileIndex,
    showFileMenu,
    fileSearchError,
    isFileSearchLoading,
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
