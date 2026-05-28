import type {
  AgentFileSearchResult,
  AgentSkillReference,
  AgentSlashCommand,
} from "@openducktor/core";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  type AgentChatComposerDraft,
  applyComposerDraftEdit,
  draftHasMeaningfulContent,
} from "./agent-chat-composer-draft";
import type {
  FileMenuState,
  SkillMenuState,
  SlashMenuState,
} from "./use-agent-chat-composer-editor-autocomplete";
import type {
  ActiveTextSelection,
  ActiveTextSelectionRange,
  TextSelectionTarget,
  UseAgentChatComposerEditorSelectionResult,
} from "./use-agent-chat-composer-editor-selection";

type KeyDownSelection = Pick<
  UseAgentChatComposerEditorSelectionResult,
  | "resolveActiveTextSelection"
  | "resolveActiveTextSelectionRange"
  | "resolveSelectionTargetForLineBreak"
  | "focusTextSegmentWithMemory"
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
  skillMenuState: SkillMenuState | null;
  filteredSlashCommands: AgentSlashCommand[];
  filteredSkills: AgentSkillReference[];
  activeSlashIndex: number;
  activeSkillIndex: number;
  activeFileIndex: number;
  moveActiveFileIndex: (direction: 1 | -1) => boolean;
  moveActiveSlashIndex: (direction: 1 | -1) => boolean;
  moveActiveSkillIndex: (direction: 1 | -1) => boolean;
  closeSlashMenu: () => void;
  closeFileMenu: () => void;
  closeSkillMenu: () => void;
  onSend: () => void;
  clearComposerContents: () => boolean;
  insertNewlineAtSelectionTarget: (selectionTarget: TextSelectionTarget | null) => boolean;
  selectSlashCommand: (command: AgentSlashCommand) => void;
  selectSkillReference: (skill: AgentSkillReference) => void;
  selectFileSearchResult: (result: AgentFileSearchResult) => void;
  applyEditResult: (result: ReturnType<typeof applyComposerDraftEdit>) => boolean;
};

const isSelectAllShortcut = (event: ReactKeyboardEvent<HTMLDivElement>): boolean => {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a";
};

const closeAutocompleteMenus = ({
  closeSlashMenu,
  closeFileMenu,
  closeSkillMenu,
}: {
  closeSlashMenu: () => void;
  closeFileMenu: () => void;
  closeSkillMenu: () => void;
}): void => {
  closeSlashMenu();
  closeFileMenu();
  closeSkillMenu();
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

const handleSkillMenuKeyDown = ({
  event,
  skillMenuState,
  filteredSkills,
  activeSkillIndex,
  moveActiveSkillIndex,
  selectSkillReference,
}: {
  event: ReactKeyboardEvent<HTMLDivElement>;
  skillMenuState: SkillMenuState | null;
  filteredSkills: AgentSkillReference[];
  activeSkillIndex: number;
  moveActiveSkillIndex: (direction: 1 | -1) => boolean;
  selectSkillReference: (skill: AgentSkillReference) => void;
}): boolean => {
  if (!skillMenuState) {
    return false;
  }

  if (event.key === "ArrowDown" && moveActiveSkillIndex(1)) {
    event.preventDefault();
    return true;
  }

  if (event.key === "ArrowUp" && moveActiveSkillIndex(-1)) {
    event.preventDefault();
    return true;
  }

  if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
    event.preventDefault();
    const skill = filteredSkills[activeSkillIndex] ?? filteredSkills[0];
    if (skill) {
      selectSkillReference(skill);
    }
    return true;
  }

  return false;
};

const removeChipEditType = (
  kind: "slash_command" | "file_reference" | "skill_mention",
): "remove_slash_command" | "remove_file_reference" | "remove_skill_reference" => {
  if (kind === "slash_command") {
    return "remove_slash_command";
  }
  if (kind === "file_reference") {
    return "remove_file_reference";
  }
  return "remove_skill_reference";
};

const removeAdjacentChip = ({
  event,
  sourceDraft,
  repairedSelection,
  applyEditResult,
  closeSlashMenu,
  closeFileMenu,
  closeSkillMenu,
}: {
  event: ReactKeyboardEvent<HTMLDivElement>;
  sourceDraft: AgentChatComposerDraft;
  repairedSelection: ActiveTextSelection;
  applyEditResult: (result: ReturnType<typeof applyComposerDraftEdit>) => boolean;
  closeSlashMenu: () => void;
  closeFileMenu: () => void;
  closeSkillMenu: () => void;
}): boolean => {
  if (event.key !== "Backspace" || repairedSelection.caretOffset !== 0) {
    return false;
  }

  const currentIndex = sourceDraft.segments.findIndex(
    (segment) => segment.id === repairedSelection.segmentId,
  );
  const previousSegment = currentIndex > 0 ? sourceDraft.segments[currentIndex - 1] : null;
  if (
    previousSegment?.kind !== "slash_command" &&
    previousSegment?.kind !== "file_reference" &&
    previousSegment?.kind !== "skill_mention"
  ) {
    return false;
  }

  event.preventDefault();
  const didApply = applyEditResult(
    applyComposerDraftEdit(sourceDraft, {
      type: removeChipEditType(previousSegment.kind),
      segmentId: previousSegment.id,
    }),
  );
  if (didApply) {
    closeAutocompleteMenus({ closeSlashMenu, closeFileMenu, closeSkillMenu });
  }
  return true;
};

const removeTrailingLineBreak = ({
  event,
  sourceDraft,
  repairedSelection,
  applyEditResult,
  closeSlashMenu,
  closeFileMenu,
  closeSkillMenu,
}: {
  event: ReactKeyboardEvent<HTMLDivElement>;
  sourceDraft: AgentChatComposerDraft;
  repairedSelection: ActiveTextSelection;
  applyEditResult: (result: ReturnType<typeof applyComposerDraftEdit>) => boolean;
  closeSlashMenu: () => void;
  closeFileMenu: () => void;
  closeSkillMenu: () => void;
}): boolean => {
  if (
    event.key !== "Backspace" ||
    event.metaKey ||
    repairedSelection.caretOffset !== repairedSelection.text.length ||
    !repairedSelection.text.endsWith("\n")
  ) {
    return false;
  }

  event.preventDefault();
  const nextText = repairedSelection.text.slice(0, -1);
  const didApply = applyEditResult(
    applyComposerDraftEdit(sourceDraft, {
      type: "update_text",
      segmentId: repairedSelection.segmentId,
      text: nextText,
      caretOffset: nextText.length,
    }),
  );
  if (didApply) {
    closeAutocompleteMenus({ closeSlashMenu, closeFileMenu, closeSkillMenu });
  }
  return true;
};

const resolveCurrentLineStart = (
  sourceDraft: AgentChatComposerDraft,
  repairedSelection: ActiveTextSelection,
  boundedCaretOffset: number,
): TextSelectionTarget | null => {
  const currentIndex = sourceDraft.segments.findIndex(
    (segment) => segment.id === repairedSelection.segmentId,
  );
  const currentSegment = sourceDraft.segments[currentIndex];
  if (!currentSegment || currentSegment.kind !== "text") {
    return null;
  }

  const segmentLineStart = currentSegment.text.lastIndexOf("\n", boundedCaretOffset - 1) + 1;
  if (segmentLineStart > 0) {
    return {
      segmentId: currentSegment.id,
      offset: segmentLineStart,
    };
  }

  let lineStart: TextSelectionTarget = {
    segmentId: currentSegment.id,
    offset: 0,
  };
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const segment = sourceDraft.segments[index];
    if (segment?.kind !== "text") {
      continue;
    }

    const previousLineBreakOffset = segment.text.lastIndexOf("\n");
    lineStart = {
      segmentId: segment.id,
      offset: previousLineBreakOffset + 1,
    };
    if (previousLineBreakOffset >= 0) {
      return lineStart;
    }
  }

  return lineStart;
};

const removeCurrentLineText = ({
  event,
  sourceDraft,
  repairedSelection,
  applyEditResult,
  closeSlashMenu,
  closeFileMenu,
  closeSkillMenu,
}: {
  event: ReactKeyboardEvent<HTMLDivElement>;
  sourceDraft: AgentChatComposerDraft;
  repairedSelection: ActiveTextSelection;
  applyEditResult: (result: ReturnType<typeof applyComposerDraftEdit>) => boolean;
  closeSlashMenu: () => void;
  closeFileMenu: () => void;
  closeSkillMenu: () => void;
}): boolean => {
  if (event.key !== "Backspace" || !event.metaKey || repairedSelection.caretOffset === null) {
    return false;
  }

  const boundedCaretOffset = Math.max(
    0,
    Math.min(repairedSelection.caretOffset, repairedSelection.text.length),
  );
  const lineStart = resolveCurrentLineStart(sourceDraft, repairedSelection, boundedCaretOffset);
  if (
    !lineStart ||
    (lineStart.segmentId === repairedSelection.segmentId && lineStart.offset >= boundedCaretOffset)
  ) {
    return false;
  }

  event.preventDefault();
  const didApply = applyEditResult(
    applyComposerDraftEdit(sourceDraft, {
      type: "remove_segment_range",
      startTextSegmentId: lineStart.segmentId,
      startOffset: lineStart.offset,
      endTextSegmentId: repairedSelection.segmentId,
      endOffset: boundedCaretOffset,
    }),
  );
  if (didApply) {
    closeAutocompleteMenus({ closeSlashMenu, closeFileMenu, closeSkillMenu });
  }
  return true;
};

const removeSelectedTextRange = ({
  event,
  sourceDraft,
  selectedRange,
  applyEditResult,
  closeSlashMenu,
  closeFileMenu,
  closeSkillMenu,
}: {
  event: ReactKeyboardEvent<HTMLDivElement>;
  sourceDraft: AgentChatComposerDraft;
  selectedRange: ActiveTextSelectionRange | null;
  applyEditResult: (result: ReturnType<typeof applyComposerDraftEdit>) => boolean;
  closeSlashMenu: () => void;
  closeFileMenu: () => void;
  closeSkillMenu: () => void;
}): boolean => {
  if (
    !selectedRange ||
    (event.key !== "Backspace" && event.key !== "Delete") ||
    (selectedRange.start.segmentId === selectedRange.end.segmentId &&
      selectedRange.start.offset >= selectedRange.end.offset)
  ) {
    return false;
  }

  event.preventDefault();
  const didApply = applyEditResult(
    applyComposerDraftEdit(sourceDraft, {
      type: "remove_segment_range",
      startTextSegmentId: selectedRange.start.segmentId,
      startOffset: selectedRange.start.offset,
      endTextSegmentId: selectedRange.end.segmentId,
      endOffset: selectedRange.end.offset,
    }),
  );
  if (didApply) {
    closeAutocompleteMenus({ closeSlashMenu, closeFileMenu, closeSkillMenu });
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
  skillMenuState,
  filteredSlashCommands,
  filteredSkills,
  activeSlashIndex,
  activeSkillIndex,
  activeFileIndex,
  moveActiveFileIndex,
  moveActiveSlashIndex,
  moveActiveSkillIndex,
  closeSlashMenu,
  closeFileMenu,
  closeSkillMenu,
  onSend,
  clearComposerContents,
  insertNewlineAtSelectionTarget,
  selectSlashCommand,
  selectSkillReference,
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

  if (
    handleSkillMenuKeyDown({
      event,
      skillMenuState,
      filteredSkills,
      activeSkillIndex,
      moveActiveSkillIndex,
      selectSkillReference,
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

  if (event.key === "Escape" && skillMenuState) {
    event.preventDefault();
    closeSkillMenu();
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

  if (
    removeSelectedTextRange({
      event,
      sourceDraft,
      selectedRange: selection.resolveActiveTextSelectionRange(root, sourceDraft),
      applyEditResult,
      closeSlashMenu,
      closeFileMenu,
      closeSkillMenu,
    })
  ) {
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

  if (
    removeCurrentLineText({
      event,
      sourceDraft,
      repairedSelection,
      applyEditResult,
      closeSlashMenu,
      closeFileMenu,
      closeSkillMenu,
    })
  ) {
    return true;
  }

  if (
    removeTrailingLineBreak({
      event,
      sourceDraft,
      repairedSelection,
      applyEditResult,
      closeSlashMenu,
      closeFileMenu,
      closeSkillMenu,
    })
  ) {
    return true;
  }

  return removeAdjacentChip({
    event,
    sourceDraft,
    repairedSelection,
    applyEditResult,
    closeSlashMenu,
    closeFileMenu,
    closeSkillMenu,
  });
};
