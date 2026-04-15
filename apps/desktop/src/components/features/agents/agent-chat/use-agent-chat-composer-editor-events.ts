import type { AgentFileSearchResult, AgentSlashCommand } from "@openducktor/core";
import {
  type ClipboardEvent as ReactClipboardEvent,
  type FocusEvent as ReactFocusEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  useCallback,
} from "react";
import { classifyAttachment } from "./agent-chat-attachments";
import {
  type AgentChatComposerDraft,
  applyComposerDraftEdit,
  draftHasMeaningfulContent,
} from "./agent-chat-composer-draft";
import {
  getComposerContentRoot,
  readEditableTextContent,
  replaceComposerSelectionWithText,
} from "./agent-chat-composer-selection";
import {
  AUTOCOMPLETE_NAVIGATION_KEYS,
  type FileMenuState,
  type SlashMenuState,
} from "./use-agent-chat-composer-editor-autocomplete";
import {
  deriveTextSelectionTargetAfterInput,
  parseComposerDraftFromRoot,
  readActiveTextSelection,
  resolveSelectionTargetFromActiveSelection,
  resolveTextSelectionTarget,
  type TextSelectionTarget,
  type UseAgentChatComposerEditorSelectionResult,
} from "./use-agent-chat-composer-editor-selection";

const isPastedImageFile = (file: File, mime?: string): boolean => {
  return classifyAttachment({ name: file.name, mime: mime || file.type }) === "image";
};

const readPastedImageFilesFromItems = (clipboardData: DataTransfer): File[] => {
  const files: File[] = [];
  for (const item of Array.from(clipboardData.items ?? [])) {
    if (item.kind !== "file") {
      continue;
    }

    const file = item.getAsFile();
    if (!file || !isPastedImageFile(file, item.type)) {
      continue;
    }

    files.push(file);
  }

  return files;
};

const readPastedImageFilesFromFiles = (clipboardData: DataTransfer): File[] => {
  const files: File[] = [];
  for (const file of Array.from(clipboardData.files ?? [])) {
    if (!isPastedImageFile(file)) {
      continue;
    }

    files.push(file);
  }

  return files;
};

const readPastedImageFiles = (clipboardData: DataTransfer): File[] => {
  const itemFiles = readPastedImageFilesFromItems(clipboardData);
  if (itemFiles.length > 0) {
    return itemFiles;
  }

  return readPastedImageFilesFromFiles(clipboardData);
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

type UseAgentChatComposerEditorEventsArgs = {
  disabled: boolean;
  onDraftChange: (draft: AgentChatComposerDraft) => void;
  onEditorInput: () => void;
  onAddFiles: (files: File[]) => void;
  onSend: () => void;
  latestDraftRef: MutableRefObject<AgentChatComposerDraft>;
  selection: Pick<
    UseAgentChatComposerEditorSelectionResult,
    | "rememberSelectionTarget"
    | "getRememberedSelectionTarget"
    | "setPendingInputState"
    | "getPendingInputState"
    | "clearPendingInputState"
    | "focusTextSegment"
    | "setPendingFocusTarget"
    | "resolveActiveTextSelection"
    | "resolveSelectionTargetForLineBreak"
    | "focusTextSegmentWithMemory"
  >;
  slashMenuState: SlashMenuState | null;
  fileMenuState: FileMenuState | null;
  filteredSlashCommands: AgentSlashCommand[];
  activeSlashIndex: number;
  activeFileIndex: number;
  closeSlashMenu: () => void;
  closeFileMenu: () => void;
  syncMenusForSelectionTarget: (
    sourceDraft: AgentChatComposerDraft,
    selectionTarget: TextSelectionTarget | null,
  ) => void;
  moveActiveFileIndex: (direction: 1 | -1) => boolean;
  moveActiveSlashIndex: (direction: 1 | -1) => boolean;
  applyEditResult: ReturnType<
    typeof useCallback<(result: ReturnType<typeof applyComposerDraftEdit>) => boolean>
  >;
  clearComposerContents: () => boolean;
  insertNewlineAtSelectionTarget: (selectionTarget: TextSelectionTarget | null) => boolean;
  selectSlashCommand: (command: AgentSlashCommand) => void;
  selectFileSearchResult: (result: AgentFileSearchResult) => void;
};

export const useAgentChatComposerEditorEvents = ({
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
}: UseAgentChatComposerEditorEventsArgs) => {
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
          selection.getPendingInputState(),
          selection.getRememberedSelectionTarget(),
        );

      selection.rememberSelectionTarget(nextDraft, nextSelectionTarget);
      latestDraftRef.current = nextDraft;
      if (activeSelectionTarget) {
        selection.setPendingFocusTarget(null);
      } else if (nextSelectionTarget) {
        const didFocusSelectionTarget = selection.focusTextSegment(
          nextSelectionTarget.segmentId,
          nextSelectionTarget.offset,
        );
        selection.setPendingFocusTarget(didFocusSelectionTarget ? null : nextSelectionTarget);
      } else {
        selection.setPendingFocusTarget(null);
      }
      selection.clearPendingInputState();
      onDraftChange(nextDraft);
      onEditorInput();
      syncMenusForSelectionTarget(nextDraft, nextSelectionTarget);
    },
    [latestDraftRef, onDraftChange, onEditorInput, selection, syncMenusForSelectionTarget],
  );

  const handleEditorPaste = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (disabled) {
        return;
      }

      const imageFiles = readPastedImageFiles(event.clipboardData);
      if (imageFiles.length > 0) {
        event.preventDefault();
        selection.clearPendingInputState();
        closeSlashMenu();
        closeFileMenu();
        onAddFiles(imageFiles);
        return;
      }

      const clipboardTypes = Array.from(event.clipboardData.types ?? []);
      const hasPlainText = clipboardTypes.includes("text/plain");
      if (!hasPlainText) {
        event.preventDefault();
        selection.clearPendingInputState();
        return;
      }

      event.preventDefault();

      const plainText = event.clipboardData.getData("text/plain");
      const sourceDraft = latestDraftRef.current;
      const activeSelection = selection.resolveActiveTextSelection(
        event.currentTarget,
        sourceDraft,
        event.target,
      );
      const selectionTarget = resolveSelectionTargetFromActiveSelection(
        sourceDraft,
        activeSelection,
      );
      selection.rememberSelectionTarget(sourceDraft, selectionTarget);
      selection.setPendingInputState(
        selectionTarget
          ? {
              ...selectionTarget,
              inputType: "insertFromPaste",
              data: plainText,
            }
          : null,
      );

      if (!replaceComposerSelectionWithText(event.currentTarget, plainText)) {
        return;
      }

      closeSlashMenu();
      closeFileMenu();
      handleEditorInput(event.currentTarget);
    },
    [
      closeFileMenu,
      closeSlashMenu,
      disabled,
      handleEditorInput,
      latestDraftRef,
      onAddFiles,
      selection,
    ],
  );

  const handleEditorBeforeInput = useCallback(
    (event: ReactFormEvent<HTMLDivElement>) => {
      const sourceDraft = latestDraftRef.current;
      const activeSelection = selection.resolveActiveTextSelection(
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
        selection.rememberSelectionTarget(sourceDraft, selectionTarget);
        selection.setPendingInputState({
          ...selectionTarget,
          inputType,
          data,
        });
      } else {
        selection.clearPendingInputState();
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
      closeSlashMenu();
      closeFileMenu();

      void insertNewlineAtSelectionTarget(
        selection.resolveSelectionTargetForLineBreak(
          event.currentTarget,
          sourceDraft,
          activeSelection,
        ),
      );
    },
    [
      clearComposerContents,
      closeFileMenu,
      closeSlashMenu,
      insertNewlineAtSelectionTarget,
      latestDraftRef,
      selection,
    ],
  );

  const syncMenusFromRoot = useCallback(
    (
      root: HTMLDivElement,
      sourceDraft: AgentChatComposerDraft,
      eventTarget?: EventTarget | null,
    ) => {
      const activeSelection = selection.resolveActiveTextSelection(root, sourceDraft, eventTarget);
      const selectionTarget = resolveSelectionTargetFromActiveSelection(
        sourceDraft,
        activeSelection,
      );
      selection.rememberSelectionTarget(sourceDraft, selectionTarget);
      syncMenusForSelectionTarget(sourceDraft, selectionTarget);
    },
    [selection, syncMenusForSelectionTarget],
  );

  const handleEditorFocus = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>) => {
      syncMenusFromRoot(event.currentTarget, latestDraftRef.current, event.target);
    },
    [latestDraftRef, syncMenusFromRoot],
  );

  const handleEditorClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      syncMenusFromRoot(event.currentTarget, latestDraftRef.current, event.target);
    },
    [latestDraftRef, syncMenusFromRoot],
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
        resolveTextSelectionTarget(sourceDraft, selection.getRememberedSelectionTarget());

      selection.rememberSelectionTarget(sourceDraft, selectionTarget);
      syncMenusForSelectionTarget(sourceDraft, selectionTarget);
    },
    [latestDraftRef, selection, syncMenusForSelectionTarget],
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
        if (event.key === "ArrowDown" && moveActiveFileIndex(1)) {
          event.preventDefault();
          return;
        }
        if (event.key === "ArrowUp" && moveActiveFileIndex(-1)) {
          event.preventDefault();
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
        if (event.key === "ArrowDown" && moveActiveSlashIndex(1)) {
          event.preventDefault();
          return;
        }
        if (event.key === "ArrowUp" && moveActiveSlashIndex(-1)) {
          event.preventDefault();
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
        closeSlashMenu();
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
          selection.resolveSelectionTargetForLineBreak(root, sourceDraft, activeSelection),
        );
        return;
      }

      const repairedSelection =
        activeSelection ?? selection.resolveActiveTextSelection(root, sourceDraft);
      if (!repairedSelection) {
        return;
      }

      if (
        event.key === "Backspace" &&
        repairedSelection.text.length === 0 &&
        !draftHasMeaningfulContent(sourceDraft)
      ) {
        event.preventDefault();
        selection.focusTextSegmentWithMemory(repairedSelection.segmentId, 0, sourceDraft);
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
            closeSlashMenu();
            closeFileMenu();
          }
        }
      }
    },
    [
      activeFileIndex,
      activeSlashIndex,
      applyEditResult,
      clearComposerContents,
      closeFileMenu,
      closeSlashMenu,
      disabled,
      fileMenuState,
      filteredSlashCommands,
      insertNewlineAtSelectionTarget,
      latestDraftRef,
      moveActiveFileIndex,
      moveActiveSlashIndex,
      onSend,
      selectFileSearchResult,
      selectSlashCommand,
      selection,
      slashMenuState,
    ],
  );

  return {
    handleEditorInput,
    handleEditorPaste,
    handleEditorBeforeInput,
    handleEditorFocus,
    handleEditorClick,
    handleEditorKeyUp,
    handleEditorKeyDown,
  };
};
