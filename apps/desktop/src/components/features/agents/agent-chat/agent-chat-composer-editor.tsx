import type { AgentSlashCommand } from "@openducktor/core";
import type { ReactElement } from "react";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  type AgentChatComposerDraft,
  draftHasMeaningfulContent,
} from "./agent-chat-composer-draft";
import { EMPTY_TEXT_SEGMENT_SENTINEL } from "./agent-chat-composer-selection";
import { AgentChatComposerSlashMenu } from "./agent-chat-composer-slash-menu";
import { useAgentChatComposerEditor } from "./use-agent-chat-composer-editor";

const shouldRedirectShellClickToComposer = (
  target: EventTarget | null,
  currentTarget: HTMLDivElement,
): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (!currentTarget.contains(target)) {
    return false;
  }

  if (target.closest('[contenteditable="true"],button,a,input,textarea,select,[role="button"]')) {
    return false;
  }

  return true;
};

const getTextSegmentElement = (target: EventTarget | null): HTMLElement | null => {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const segmentElement = target.closest<HTMLElement>("[data-segment-id]");
  if (!segmentElement?.isContentEditable) {
    return null;
  }

  return segmentElement;
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
  const {
    filteredSlashCommands,
    activeSlashIndex,
    showSlashMenu,
    registerTextSegmentRef,
    focusLastTextSegment,
    focusSlashCommandSegment,
    selectSlashCommand,
    handleTextInput,
    handleTextFocus,
    handleTextClick,
    handleTextKeyUp,
    handleTextKeyDown,
  } = useAgentChatComposerEditor({
    draft,
    onDraftChange,
    disabled,
    onEditorInput,
    onSend,
    supportsSlashCommands,
    slashCommands,
  });

  return (
    <div className="relative">
      {showSlashMenu ? (
        <AgentChatComposerSlashMenu
          commands={filteredSlashCommands}
          activeIndex={activeSlashIndex}
          slashCommandsError={slashCommandsError}
          isSlashCommandsLoading={isSlashCommandsLoading}
          onSelectCommand={selectSlashCommand}
        />
      ) : null}

      {/* biome-ignore lint/a11y/noStaticElementInteractions: editor shell needs click-to-focus behavior for empty token content. */}
      <div
        ref={editorRef}
        className={cn(
          "min-h-11 max-h-[220px] overflow-y-auto px-3 py-2.5 text-[15px] leading-6 outline-none",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-text",
        )}
        aria-disabled={disabled}
        onMouseDownCapture={(event) => {
          if (disabled || !shouldRedirectShellClickToComposer(event.target, event.currentTarget)) {
            return;
          }
          event.preventDefault();
          focusLastTextSegment();
        }}
        onMouseUpCapture={(event) => {
          const segmentElement = getTextSegmentElement(event.target);
          if (!segmentElement) {
            return;
          }

          const segmentId = segmentElement.dataset.segmentId;
          if (!segmentId) {
            return;
          }

          handleTextClick(segmentId, segmentElement);
        }}
      >
        {!draftHasMeaningfulContent(draft) ? (
          <div className="pointer-events-none absolute left-3 top-2.5 text-[15px] leading-6 text-muted-foreground">
            {placeholder}
          </div>
        ) : null}

        <div className="relative z-10 min-h-6 whitespace-pre-wrap break-words">
          {draft.segments.map((segment) => {
            if (segment.kind === "slash_command") {
              return (
                <button
                  key={segment.id}
                  type="button"
                  contentEditable={false}
                  aria-label={`Slash command /${segment.command.trigger}. Press Backspace immediately after the chip to remove it.`}
                  className={cn(
                    badgeVariants({ variant: "secondary" }),
                    "mx-0.5 inline-flex h-7 align-baseline rounded-full border border-border px-2.5 text-xs font-medium",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => focusSlashCommandSegment(segment.id)}
                >
                  /{segment.command.trigger}
                </button>
              );
            }

            return (
              /* biome-ignore lint/a11y/noStaticElementInteractions: inline contenteditable segments need custom caret and keyboard handling. */
              <span
                key={segment.id}
                ref={(element) => registerTextSegmentRef(segment.id, element)}
                contentEditable={!disabled}
                suppressContentEditableWarning
                spellCheck={false}
                data-segment-id={segment.id}
                className="inline whitespace-pre-wrap break-words align-baseline outline-none"
                onInput={(event) => handleTextInput(segment.id, event.currentTarget)}
                onFocus={(event) => handleTextFocus(segment.id, event.currentTarget)}
                onKeyUp={(event) => handleTextKeyUp(segment.id, event)}
                onKeyDown={(event) => handleTextKeyDown(segment.id, event)}
              >
                {segment.text.length > 0 ? segment.text : EMPTY_TEXT_SEGMENT_SENTINEL}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
