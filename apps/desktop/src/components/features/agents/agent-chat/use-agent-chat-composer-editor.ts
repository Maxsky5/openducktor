import type { AgentSlashCommand } from "@openducktor/core";
import {
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
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
  readSlashTriggerMatch,
} from "./agent-chat-composer-draft";
import {
  EMPTY_TEXT_SEGMENT_SENTINEL,
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

type UseAgentChatComposerEditorArgs = {
  draft: AgentChatComposerDraft;
  onDraftChange: (draft: AgentChatComposerDraft) => void;
  disabled: boolean;
  onEditorInput: () => void;
  onSend: () => void;
  supportsSlashCommands: boolean;
  slashCommands: AgentSlashCommand[];
};

type UseAgentChatComposerEditorResult = {
  filteredSlashCommands: AgentSlashCommand[];
  activeSlashIndex: number;
  showSlashMenu: boolean;
  registerTextSegmentRef: (segmentId: string, element: HTMLElement | null) => void;
  focusLastTextSegment: () => void;
  focusSlashCommandSegment: (segmentId: string) => void;
  selectSlashCommand: (command: AgentSlashCommand) => void;
  handleTextInput: (segmentId: string, element: HTMLElement) => void;
  handleTextBeforeInput: (segmentId: string, event: ReactFormEvent<HTMLElement>) => void;
  handleTextFocus: (segmentId: string, element: HTMLElement) => void;
  handleTextClick: (segmentId: string, element: HTMLElement) => void;
  handleTextKeyUp: (segmentId: string, event: ReactKeyboardEvent<HTMLElement>) => void;
  handleTextKeyDown: (segmentId: string, event: ReactKeyboardEvent<HTMLElement>) => void;
};

const SLASH_MENU_NAVIGATION_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"]);

const filterSlashCommands = (commands: AgentSlashCommand[], query: string): AgentSlashCommand[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return commands;
  }

  return commands.filter((command) => {
    const haystacks = [command.trigger, command.title, command.description ?? "", ...command.hints];
    return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
  });
};

const usePendingFocus = () => {
  const textSegmentRefs = useRef<Record<string, HTMLElement | null>>({});
  const pendingFocusRef = useRef<AgentChatComposerDraftEditResult["focusTarget"]>(null);

  useLayoutEffect(() => {
    const pendingFocus = pendingFocusRef.current;
    if (!pendingFocus) {
      return;
    }

    const target = textSegmentRefs.current[pendingFocus.segmentId];
    if (!target) {
      return;
    }

    setCaretOffsetWithinElement(target, pendingFocus.offset);
    pendingFocusRef.current = null;
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

const usePendingSyntheticInputSuppression = () => {
  const suppressedSegmentsRef = useRef<Record<string, boolean>>({});

  return {
    suppressNextInput: (segmentId: string) => {
      suppressedSegmentsRef.current[segmentId] = true;
    },
    consumeSuppressedInput: (segmentId: string): boolean => {
      if (!suppressedSegmentsRef.current[segmentId]) {
        return false;
      }
      delete suppressedSegmentsRef.current[segmentId];
      return true;
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
  slashCommands,
}: UseAgentChatComposerEditorArgs): UseAgentChatComposerEditorResult => {
  const { registerTextSegmentRef, focusTextSegment, setPendingFocusTarget } = usePendingFocus();
  const { rememberCaretOffset, readCaretOffset } = useLastKnownCaretOffsets();
  const { suppressNextInput, consumeSuppressedInput } = usePendingSyntheticInputSuppression();
  const [slashMenuState, setSlashMenuState] = useState<SlashMenuState | null>(null);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);

  const filteredSlashCommands = useMemo(() => {
    if (!slashMenuState) {
      return [];
    }
    return filterSlashCommands(slashCommands, slashMenuState.query);
  }, [slashCommands, slashMenuState]);

  const updateSlashMenuForText = useCallback(
    (segmentId: string, text: string, caretOffset: number | null) => {
      if (disabled || !supportsSlashCommands || caretOffset === null) {
        setActiveSlashIndex(0);
        setSlashMenuState(null);
        return;
      }

      const match = readSlashTriggerMatch(text, caretOffset);
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

  const syncSlashMenuFromElement = useCallback(
    (segmentId: string, element: HTMLElement) => {
      const caretOffset = getCaretOffsetWithinElement(element);
      rememberCaretOffset(segmentId, caretOffset);
      updateSlashMenuForText(segmentId, readEditableTextContent(element), caretOffset);
    },
    [rememberCaretOffset, updateSlashMenuForText],
  );

  const handleTextInput = useCallback(
    (segmentId: string, element: HTMLElement) => {
      if (consumeSuppressedInput(segmentId)) {
        return;
      }

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
    },
    [applyEditResult, consumeSuppressedInput, draft, rememberCaretOffset, updateSlashMenuForText],
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

      event.preventDefault();
      suppressNextInput(segmentId);
      const result = applyComposerDraftEdit(draft, {
        type: "insert_newline",
        segmentId,
        caretOffset,
      });
      const updatedSegment = result?.draft.segments.find(
        (
          segment,
        ): segment is Extract<AgentChatComposerDraft["segments"][number], { kind: "text" }> =>
          segment.id === segmentId && segment.kind === "text",
      );
      if (updatedSegment) {
        event.currentTarget.textContent =
          updatedSegment.text.length > 0 ? updatedSegment.text : EMPTY_TEXT_SEGMENT_SENTINEL;
      }
      const didApply = applyEditResult(result);
      if (didApply) {
        setSlashMenuState(null);
      }
    },
    [applyEditResult, draft, readCaretOffset, suppressNextInput],
  );

  const handleTextKeyUp = useCallback(
    (segmentId: string, event: ReactKeyboardEvent<HTMLElement>) => {
      if (SLASH_MENU_NAVIGATION_KEYS.has(event.key)) {
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

      if (slashMenuState && filteredSlashCommands.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveSlashIndex((current) => (current + 1) % filteredSlashCommands.length);
          return;
        }
        if (event.key === "ArrowUp") {
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
        event.preventDefault();
        const didApply = applyEditResult(
          applyComposerDraftEdit(draft, {
            type: "insert_newline",
            segmentId,
            caretOffset,
          }),
        );
        if (didApply) {
          setSlashMenuState(null);
        }
        return;
      }

      if (event.key === "Backspace" && caretOffset === 0) {
        const currentIndex = draft.segments.findIndex((segment) => segment.id === segmentId);
        const previousSegment = currentIndex > 0 ? draft.segments[currentIndex - 1] : null;
        if (previousSegment?.kind === "slash_command") {
          event.preventDefault();
          const didApply = applyEditResult(
            applyComposerDraftEdit(draft, {
              type: "remove_slash_command",
              segmentId: previousSegment.id,
            }),
          );
          if (didApply) {
            setSlashMenuState(null);
          }
        }
      }
    },
    [
      activeSlashIndex,
      applyEditResult,
      disabled,
      draft,
      filteredSlashCommands,
      onSend,
      readCaretOffset,
      rememberCaretOffset,
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
      focusTextSegment(segment.id, segment.text.length);
      return;
    }
  }, [draft.segments, focusTextSegment]);

  const focusSlashCommandSegment = useCallback(
    (segmentId: string) => {
      const currentIndex = draft.segments.findIndex((segment) => segment.id === segmentId);
      if (currentIndex < 0) {
        return;
      }

      const nextSegment = draft.segments[currentIndex + 1];
      if (nextSegment?.kind === "text") {
        focusTextSegment(nextSegment.id, 0);
        return;
      }

      const previousSegment = draft.segments[currentIndex - 1];
      if (previousSegment?.kind === "text") {
        focusTextSegment(previousSegment.id, previousSegment.text.length);
      }
    },
    [draft.segments, focusTextSegment],
  );

  return {
    filteredSlashCommands,
    activeSlashIndex,
    showSlashMenu: supportsSlashCommands && slashMenuState !== null,
    registerTextSegmentRef,
    focusLastTextSegment,
    focusSlashCommandSegment,
    selectSlashCommand,
    handleTextInput,
    handleTextBeforeInput,
    handleTextFocus: syncSlashMenuFromElement,
    handleTextClick: syncSlashMenuFromElement,
    handleTextKeyUp,
    handleTextKeyDown,
  };
};
