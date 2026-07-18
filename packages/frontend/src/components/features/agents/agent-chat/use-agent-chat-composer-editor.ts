import type {
  AgentFileSearchResult,
  AgentSkillReference,
  AgentSlashCommand,
  AgentSubagentReference,
} from "@openducktor/core";
import {
  type ClipboardEvent as ReactClipboardEvent,
  type FocusEvent as ReactFocusEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";
import {
  type AgentChatComposerDraft,
  applyComposerDraftEdit,
  createTextSegment,
  normalizeComposerDraft,
} from "./agent-chat-composer-draft";
import { closeComposerAutocompleteMenus } from "./agent-chat-composer-menu-state";
import {
  type ReferenceMenuItem,
  useAgentChatComposerEditorAutocomplete,
} from "./use-agent-chat-composer-editor-autocomplete";
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
  supportsSkillReferences: boolean;
  supportsSubagentReferences: boolean;
  slashCommands: AgentSlashCommand[];
  skills: AgentSkillReference[];
  subagents: AgentSubagentReference[];
  searchFiles: (query: string) => Promise<AgentFileSearchResult[]>;
};

type UseAgentChatComposerEditorResult = {
  filteredSlashCommands: AgentSlashCommand[];
  filteredSkills: AgentSkillReference[];
  referenceMenuItems: ReferenceMenuItem[];
  activeSlashIndex: number;
  activeSkillIndex: number;
  showSlashMenu: boolean;
  showSkillMenu: boolean;
  activeReferenceIndex: number;
  showReferenceMenu: boolean;
  fileSearchError: string | null;
  isFileSearchPending: boolean;
  isFileSearchLoading: boolean;
  focusLastTextSegment: () => void;
  selectSlashCommand: (command: AgentSlashCommand) => void;
  selectSkillReference: (skill: AgentSkillReference) => void;
  selectSubagentReference: (subagent: AgentSubagentReference) => void;
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
  supportsSkillReferences,
  supportsSubagentReferences,
  slashCommands,
  skills,
  subagents,
  searchFiles,
}: UseAgentChatComposerEditorArgs): UseAgentChatComposerEditorResult => {
  const latestDraftRef = useRef(draft);

  useLayoutEffect(() => {
    latestDraftRef.current = draft;
  }, [draft]);

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
    supportsSkillReferences,
    supportsSubagentReferences,
    slashCommands,
    skills,
    subagents,
    searchFiles,
  });
  const {
    slashMenuState,
    referenceMenuState,
    skillMenuState,
    filteredSlashCommands,
    filteredSkills,
    referenceMenuItems,
    activeSlashIndex,
    activeSkillIndex,
    activeReferenceIndex,
    showSlashMenu,
    showSkillMenu,
    showReferenceMenu,
    fileSearchError,
    isFileSearchPending,
    isFileSearchLoading,
    closeSlashMenu,
    closeReferenceMenu,
    closeSkillMenu,
    syncMenusForSelectionTarget,
    moveActiveReferenceIndex,
    moveActiveSlashIndex,
    moveActiveSkillIndex,
  } = autocomplete;

  const applyEditResult = useCallback(
    (result: ReturnType<typeof applyComposerDraftEdit>) => {
      if (!result) {
        return false;
      }

      clearPendingInputState();
      latestDraftRef.current = result.draft;
      rememberSelectionTarget(result.draft, result.focusTarget);

      onDraftChange(result.draft);
      onEditorInput();

      if (result.focusTarget) {
        focusTextSegment(result.focusTarget.segmentId, result.focusTarget.offset);
        setPendingFocusTarget(result.focusTarget);
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

      closeComposerAutocompleteMenus({
        closeSlashMenu,
        closeReferenceMenu,
        closeSkillMenu,
      });
      return true;
    },
    [
      applyEditResult,
      closeReferenceMenu,
      closeSkillMenu,
      closeSlashMenu,
      getRememberedSelectionTarget,
    ],
  );

  const clearComposerContents = useCallback(() => {
    const nextDraft = normalizeComposerDraft({
      segments: [createTextSegment("")],
      attachments: latestDraftRef.current.attachments ?? [],
    });
    const firstSegment = nextDraft.segments[0];
    if (firstSegment?.kind !== "text") {
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

    closeComposerAutocompleteMenus({
      closeSlashMenu,
      closeReferenceMenu,
      closeSkillMenu,
    });
    return true;
  }, [applyEditResult, closeReferenceMenu, closeSkillMenu, closeSlashMenu]);

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
      if (!referenceMenuState) {
        return;
      }

      const sourceDraft = latestDraftRef.current;

      const didApply = applyEditResult(
        applyComposerDraftEdit(sourceDraft, {
          type: "insert_file_reference",
          textSegmentId: referenceMenuState.textSegmentId,
          rangeStart: referenceMenuState.rangeStart,
          rangeEnd: referenceMenuState.rangeEnd,
          file: result,
        }),
      );
      if (didApply) {
        closeReferenceMenu();
      }
    },
    [applyEditResult, closeReferenceMenu, referenceMenuState],
  );

  const selectSkillReference = useCallback(
    (skill: AgentSkillReference) => {
      if (!skillMenuState) {
        return;
      }

      const didApply = applyEditResult(
        applyComposerDraftEdit(latestDraftRef.current, {
          type: "insert_skill_reference",
          textSegmentId: skillMenuState.textSegmentId,
          rangeStart: skillMenuState.rangeStart,
          rangeEnd: skillMenuState.rangeEnd,
          skill,
        }),
      );
      if (didApply) {
        closeSkillMenu();
      }
    },
    [applyEditResult, closeSkillMenu, skillMenuState],
  );

  const selectSubagentReference = useCallback(
    (subagent: AgentSubagentReference) => {
      if (!referenceMenuState) {
        return;
      }

      const didApply = applyEditResult(
        applyComposerDraftEdit(latestDraftRef.current, {
          type: "insert_subagent_reference",
          textSegmentId: referenceMenuState.textSegmentId,
          rangeStart: referenceMenuState.rangeStart,
          rangeEnd: referenceMenuState.rangeEnd,
          subagent,
        }),
      );
      if (didApply) {
        closeReferenceMenu();
      }
    },
    [applyEditResult, closeReferenceMenu, referenceMenuState],
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
    referenceMenuState,
    skillMenuState,
    filteredSlashCommands,
    filteredSkills,
    referenceMenuItems,
    activeSlashIndex,
    activeSkillIndex,
    activeReferenceIndex,
    closeSlashMenu,
    closeReferenceMenu,
    closeSkillMenu,
    syncMenusForSelectionTarget,
    moveActiveReferenceIndex,
    moveActiveSlashIndex,
    moveActiveSkillIndex,
    applyEditResult,
    clearComposerContents,
    insertNewlineAtSelectionTarget,
    selectSlashCommand,
    selectSkillReference,
    selectSubagentReference,
    selectFileSearchResult,
  });

  const focusLastTextSegment = useCallback(() => {
    focusLastTextSegmentFromSelection(latestDraftRef.current);
  }, [focusLastTextSegmentFromSelection]);

  return {
    filteredSlashCommands,
    filteredSkills,
    referenceMenuItems,
    activeSlashIndex,
    activeSkillIndex,
    showSlashMenu,
    showSkillMenu,
    activeReferenceIndex,
    showReferenceMenu,
    fileSearchError,
    isFileSearchPending,
    isFileSearchLoading,
    focusLastTextSegment,
    selectSlashCommand,
    selectSkillReference,
    selectSubagentReference,
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
