import type { AgentFileSearchResult, AgentSlashCommand } from "@openducktor/core";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  applyComposerDraftEdit,
  draftHasMeaningfulContent,
  type AgentChatComposerDraft,
} from "./agent-chat-composer-draft";
import type { FileMenuState, SlashMenuState } from "./use-agent-chat-composer-editor-autocomplete";
import type {
  ActiveTextSelection,
  TextSelectionTarget,
  UseAgentChatComposerEditorSelectionResult,
} from "./use-agent-chat-composer-editor-selection";

type KeyDownSelection = Pick<
  UseAgentChatComposerEditorSelectionResult,
  "resolveActiveTextSelection" | "resolveSelectionTargetForLineBreak" | "focusTextSegmentWithMemory"
>;

type HandleComposerEditorKeyDownArgs = {
  event: ReactKeyboardEvent<HTMLDivElement>;
  root: HTMLDivElement;
  sourceDraft: AgentChatComposerDraft;
  activeSelection: ActiveTextSelection | null;
  disabled: boolean;
  selection: KeyDownSelection;
  selectComposerContents: (root: HTMLDivElement) => boolean;
  isComposerContentFullySelected: (root: HTMLDivElement) => boolean;
  fileMenuState: FileMenuState | null;
  slashMenuState: SlashMenuState | null;
  filteredSlashCommands: AgentSlashCommand[];
  activeSlashIndex: number;
  activeFileIndex: number;
  moveActiveFileIndex: (direction: 1 | -1) => boolean;
  moveActiveSlashIndex: (direction: 1 | -1) => boolean;
  closeSlashMenu: () => void;
  closeFileMenu: () => void;
  onSend: () => void;
  clearComposerContents: () => boolean;
  insertNewlineAtSelectionTarget: (selectionTarget: TextSelectionTarget | null) => boolean;
  selectSlashCommand: (command: AgentSlashCommand) => void;
  selectFileSearchResult: (result: AgentFileSearchResult) => void;
  applyEditResult: (result: ReturnType<typeof applyComposerDraftEdit>) => boolean;
};

const isSelectAllShortcut = (event: ReactKeyboardEvent<HTMLDivElement>): boolean => {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a";
};

const closeAutocompleteMenus = ({
  closeSlashMenu,
  closeFileMenu,
}: {
  closeSlashMenu: () => void;
  closeFileMenu: () => void;
}): void => {
  closeSlashMenu();
  closeFileMenu();
};

const handleFileMenuKeyDown = ({
  event,
  fileMenuState,
  activeFileIndex,
  moveActiveFileIndex,
  selectFileSearchResult,
}: {
  event: ReactKeyboardEvent<HTMLDivElement>;
  fileMenuState: FileMenuState | null;
  activeFileIndex: number;
  moveActiveFileIndex: (direction: 1 | -1) => boolean;
  selectFileSearchResult: (result: AgentFileSearchResult) => void;
}): boolean => {
  if (!fileMenuState) {
    return false;
  }

  if (event.key === "ArrowDown" && moveActiveFileIndex(1)) {
    event.preventDefault();
    return true;
  }

  if (event.key === "ArrowUp" && moveActiveFileIndex(-1)) {
    event.preventDefault();
    return true;
  }

  if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
    event.preventDefault();
    const result = fileMenuState.results[activeFileIndex] ?? fileMenuState.results[0];
    if (result) {
      selectFileSearchResult(result);
    }
    return true;
  }

  return false;
};

const handleSlashMenuKeyDown = ({
  event,
  slashMenuState,
  filteredSlashCommands,
  activeSlashIndex,
  moveActiveSlashIndex,
  selectSlashCommand,
}: {
  event: ReactKeyboardEvent<HTMLDivElement>;
  slashMenuState: SlashMenuState | null;
  filteredSlashCommands: AgentSlashCommand[];
  activeSlashIndex: number;
  moveActiveSlashIndex: (direction: 1 | -1) => boolean;
  selectSlashCommand: (command: AgentSlashCommand) => void;
}): boolean => {
  if (!slashMenuState) {
    return false;
  }

  if (event.key === "ArrowDown" && moveActiveSlashIndex(1)) {
    event.preventDefault();
    return true;
  }

  if (event.key === "ArrowUp" && moveActiveSlashIndex(-1)) {
    event.preventDefault();
    return true;
  }

  if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
    event.preventDefault();
    const command = filteredSlashCommands[activeSlashIndex] ?? filteredSlashCommands[0];
    if (command) {
      selectSlashCommand(command);
    }
    return true;
  }

  return false;
};

const removeAdjacentChip = ({
  event,
  sourceDraft,
  repairedSelection,
  applyEditResult,
  closeSlashMenu,
  closeFileMenu,
}: {
  event: ReactKeyboardEvent<HTMLDivElement>;
  sourceDraft: AgentChatComposerDraft;
  repairedSelection: ActiveTextSelection;
  applyEditResult: (result: ReturnType<typeof applyComposerDraftEdit>) => boolean;
  closeSlashMenu: () => void;
  closeFileMenu: () => void;
}): boolean => {
  if (event.key !== "Backspace" || repairedSelection.caretOffset !== 0) {
    return false;
  }

  const currentIndex = sourceDraft.segments.findIndex(
    (segment) => segment.id === repairedSelection.segmentId,
  );
  const previousSegment = currentIndex > 0 ? sourceDraft.segments[currentIndex - 1] : null;
  if (previousSegment?.kind !== "slash_command" && previousSegment?.kind !== "file_reference") {
    return false;
  }

  event.preventDefault();
  const didApply = applyEditResult(
    applyComposerDraftEdit(sourceDraft, {
      type:
        previousSegment.kind === "slash_command" ? "remove_slash_command" : "remove_file_reference",
      segmentId: previousSegment.id,
    }),
  );
  if (didApply) {
    closeAutocompleteMenus({ closeSlashMenu, closeFileMenu });
  }
  return true;
};

export const handleComposerEditorKeyDown = ({
  event,
  root,
  sourceDraft,
  activeSelection,
  disabled,
  selection,
  selectComposerContents,
  isComposerContentFullySelected,
  fileMenuState,
  slashMenuState,
  filteredSlashCommands,
  activeSlashIndex,
  activeFileIndex,
  moveActiveFileIndex,
  moveActiveSlashIndex,
  closeSlashMenu,
  closeFileMenu,
  onSend,
  clearComposerContents,
  insertNewlineAtSelectionTarget,
  selectSlashCommand,
  selectFileSearchResult,
  applyEditResult,
}: HandleComposerEditorKeyDownArgs): boolean => {
  if (isSelectAllShortcut(event)) {
    if (selectComposerContents(root)) {
      event.preventDefault();
    }
    return true;
  }

  if (
    (event.key === "Backspace" || event.key === "Delete") &&
    isComposerContentFullySelected(root)
  ) {
    event.preventDefault();
    void clearComposerContents();
    return true;
  }

  if (
    handleFileMenuKeyDown({
      event,
      fileMenuState,
      activeFileIndex,
      moveActiveFileIndex,
      selectFileSearchResult,
    })
  ) {
    return true;
  }

  if (
    handleSlashMenuKeyDown({
      event,
      slashMenuState,
      filteredSlashCommands,
      activeSlashIndex,
      moveActiveSlashIndex,
      selectSlashCommand,
    })
  ) {
    return true;
  }

  if (event.key === "Escape" && fileMenuState) {
    event.preventDefault();
    closeFileMenu();
    return true;
  }

  if (event.key === "Escape" && slashMenuState) {
    event.preventDefault();
    closeSlashMenu();
    return true;
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (!disabled && draftHasMeaningfulContent(sourceDraft)) {
      onSend();
    }
    return true;
  }

  if (event.key === "Enter" && event.shiftKey) {
    event.preventDefault();
    void insertNewlineAtSelectionTarget(
      selection.resolveSelectionTargetForLineBreak(root, sourceDraft, activeSelection),
    );
    return true;
  }

  const repairedSelection =
    activeSelection ?? selection.resolveActiveTextSelection(root, sourceDraft);
  if (!repairedSelection) {
    return false;
  }

  if (
    event.key === "Backspace" &&
    repairedSelection.text.length === 0 &&
    !draftHasMeaningfulContent(sourceDraft)
  ) {
    event.preventDefault();
    selection.focusTextSegmentWithMemory(repairedSelection.segmentId, 0, sourceDraft);
    return true;
  }

  return removeAdjacentChip({
    event,
    sourceDraft,
    repairedSelection,
    applyEditResult,
    closeSlashMenu,
    closeFileMenu,
  });
};
