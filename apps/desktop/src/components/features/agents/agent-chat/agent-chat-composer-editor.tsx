import type { AgentSlashCommand } from "@openducktor/core";
import { ChevronRight, LoaderCircle, Terminal } from "lucide-react";
import {
  Fragment,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  type AgentChatComposerDraft,
  createTextSegment,
  draftHasMeaningfulContent,
  isTextSegment,
  readSlashTriggerMatch,
  removeSlashCommandSegmentFromDraft,
  replaceTextRangeWithSlashCommand,
  updateTextSegmentInDraft,
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

type AgentChatComposerEditorProps = {
  draft: AgentChatComposerDraft;
  onDraftChange: (draft: AgentChatComposerDraft) => void;
  placeholder: string;
  disabled: boolean;
  editorRef: React.RefObject<HTMLDivElement | null>;
  onEditorInput: () => void;
  onSend: () => void;
  supportsSlashCommands: boolean;
  slashCommands: AgentSlashCommand[];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
};

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

export function AgentChatComposerEditor({
  draft,
  onDraftChange,
  placeholder,
  disabled,
  editorRef,
  onEditorInput,
  onSend,
  supportsSlashCommands,
  slashCommands,
  slashCommandsError,
  isSlashCommandsLoading,
}: AgentChatComposerEditorProps): ReactElement {
  const textSegmentRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const [slashMenuState, setSlashMenuState] = useState<SlashMenuState | null>(null);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const pendingFocusRef = useRef<{ segmentId: string; offset: number } | null>(null);

  const filteredSlashCommands = useMemo(() => {
    if (!slashMenuState) {
      return [];
    }
    return filterSlashCommands(slashCommands, slashMenuState.query);
  }, [slashCommands, slashMenuState]);

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

  const selectSlashCommand = useCallback(
    (command: AgentSlashCommand) => {
      if (!slashMenuState) {
        return;
      }

      const replacement = replaceTextRangeWithSlashCommand(
        draft,
        slashMenuState.textSegmentId,
        slashMenuState.rangeStart,
        slashMenuState.rangeEnd,
        command,
      );
      if (!replacement) {
        return;
      }

      pendingFocusRef.current = {
        segmentId: replacement.focusSegmentId,
        offset: replacement.focusOffset,
      };
      setSlashMenuState(null);
      onDraftChange(replacement.draft);
      onEditorInput();
    },
    [draft, onDraftChange, onEditorInput, slashMenuState],
  );

  const handleTextInput = useCallback(
    (segmentId: string, element: HTMLSpanElement) => {
      const nextText = readEditableTextContent(element);
      const nextDraft = updateTextSegmentInDraft(draft, segmentId, nextText);
      onDraftChange(nextDraft);
      updateSlashMenuForText(segmentId, nextText, getCaretOffsetWithinElement(element));
      onEditorInput();
    },
    [draft, onDraftChange, onEditorInput, updateSlashMenuForText],
  );

  const handleTextKeyDown = useCallback(
    (segmentId: string, event: ReactKeyboardEvent<HTMLSpanElement>) => {
      const target = event.currentTarget;
      const caretOffset = getCaretOffsetWithinElement(target);

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
        const text = readEditableTextContent(target);
        const nextText = `${text.slice(0, caretOffset)}\n${text.slice(caretOffset)}`;
        pendingFocusRef.current = { segmentId, offset: caretOffset + 1 };
        onDraftChange(updateTextSegmentInDraft(draft, segmentId, nextText));
        setSlashMenuState(null);
        onEditorInput();
        return;
      }

      if (event.key === "Backspace" && caretOffset === 0) {
        const currentIndex = draft.segments.findIndex((segment) => segment.id === segmentId);
        const previousSegment = currentIndex > 0 ? draft.segments[currentIndex - 1] : null;
        if (previousSegment?.kind === "slash_command") {
          event.preventDefault();
          const removal = removeSlashCommandSegmentFromDraft(draft, previousSegment.id);
          if (!removal) {
            return;
          }
          pendingFocusRef.current = {
            segmentId: removal.focusSegmentId,
            offset: removal.focusOffset,
          };
          setSlashMenuState(null);
          onDraftChange(removal.draft);
          onEditorInput();
        }
      }
    },
    [
      activeSlashIndex,
      disabled,
      draft,
      filteredSlashCommands,
      onDraftChange,
      onEditorInput,
      onSend,
      selectSlashCommand,
      slashMenuState,
    ],
  );

  const showSlashMenu = supportsSlashCommands && slashMenuState !== null;

  return (
    <div className="relative">
      {showSlashMenu ? (
        <div className="absolute inset-x-3 bottom-full z-20 mb-2 rounded-xl border border-border bg-popover p-1.5 shadow-lg">
          {isSlashCommandsLoading ? (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              <span>Loading slash commands...</span>
            </div>
          ) : slashCommandsError ? (
            <div className="px-3 py-2 text-sm text-destructive">{slashCommandsError}</div>
          ) : filteredSlashCommands.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No slash commands found.</div>
          ) : (
            <div className="flex max-h-64 flex-col overflow-y-auto">
              {filteredSlashCommands.map((command, index) => {
                const isActive = index === activeSlashIndex;
                return (
                  <button
                    key={command.id}
                    type="button"
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                      isActive ? "bg-muted" : "hover:bg-muted/80",
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectSlashCommand(command)}
                  >
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Terminal className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <span className="truncate">/{command.trigger}</span>
                        {command.source ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {command.source}
                          </span>
                        ) : null}
                      </span>
                      {command.description ? (
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {command.description}
                        </span>
                      ) : null}
                    </span>
                    <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      <div
        ref={editorRef}
        className={cn(
          "min-h-11 max-h-[220px] overflow-y-auto px-3 py-2.5 text-[15px] leading-6 outline-none",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-text",
        )}
        aria-disabled={disabled}
      >
        {!draftHasMeaningfulContent(draft) ? (
          <div className="pointer-events-none absolute left-3 top-2.5 text-[15px] leading-6 text-muted-foreground">
            {placeholder}
          </div>
        ) : null}

        <div className="relative z-10 flex flex-wrap items-center gap-x-1 gap-y-1 whitespace-pre-wrap break-words">
          {draft.segments.map((segment) => {
            if (segment.kind === "slash_command") {
              return (
                <span
                  key={segment.id}
                  contentEditable={false}
                  className={cn(
                    badgeVariants({ variant: "secondary" }),
                    "h-7 rounded-full border border-border px-2.5 text-xs font-medium",
                  )}
                >
                  /{segment.command.trigger}
                </span>
              );
            }

            return (
              <Fragment key={segment.id}>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: contenteditable token segments need custom caret behavior. */}
                <div
                  ref={(element) => {
                    textSegmentRefs.current[segment.id] = element;
                  }}
                  contentEditable={!disabled}
                  suppressContentEditableWarning
                  spellCheck={false}
                  data-segment-id={segment.id}
                  className="min-w-[1px] flex-1 whitespace-pre-wrap break-words outline-none"
                  onInput={(event) => handleTextInput(segment.id, event.currentTarget)}
                  onFocus={(event) => {
                    updateSlashMenuForText(
                      segment.id,
                      readEditableTextContent(event.currentTarget),
                      getCaretOffsetWithinElement(event.currentTarget),
                    );
                  }}
                  onKeyUp={(event) => {
                    updateSlashMenuForText(
                      segment.id,
                      readEditableTextContent(event.currentTarget),
                      getCaretOffsetWithinElement(event.currentTarget),
                    );
                  }}
                  onKeyDown={(event) => handleTextKeyDown(segment.id, event)}
                >
                  {segment.text.length > 0 ? segment.text : EMPTY_TEXT_SEGMENT_SENTINEL}
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
