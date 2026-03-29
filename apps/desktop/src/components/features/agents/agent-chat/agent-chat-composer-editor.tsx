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
    selectSlashCommand,
    handleTextInput,
    handleTextFocus,
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
              <div key={segment.id}>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: contenteditable token segments need custom caret behavior. */}
                <div
                  ref={(element) => registerTextSegmentRef(segment.id, element)}
                  contentEditable={!disabled}
                  suppressContentEditableWarning
                  spellCheck={false}
                  data-segment-id={segment.id}
                  className="min-w-[1px] flex-1 whitespace-pre-wrap break-words outline-none"
                  onInput={(event) => handleTextInput(segment.id, event.currentTarget)}
                  onFocus={(event) => handleTextFocus(segment.id, event.currentTarget)}
                  onKeyUp={(event) => handleTextKeyUp(segment.id, event.currentTarget)}
                  onKeyDown={(event) => handleTextKeyDown(segment.id, event)}
                >
                  {segment.text.length > 0 ? segment.text : EMPTY_TEXT_SEGMENT_SENTINEL}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
