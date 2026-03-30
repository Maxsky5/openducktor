import type { AgentFileSearchResult, AgentSlashCommand } from "@openducktor/core";
import type { ReactElement } from "react";
import { badgeVariants } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  type AgentChatComposerDraft,
  draftHasMeaningfulContent,
} from "./agent-chat-composer-draft";
import { AgentChatComposerFileMenu } from "./agent-chat-composer-file-menu";
import { EMPTY_TEXT_SEGMENT_SENTINEL } from "./agent-chat-composer-selection";
import { AgentChatComposerSlashMenu } from "./agent-chat-composer-slash-menu";
import { AgentChatFileReferenceIcon } from "./agent-chat-file-reference-icon";
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
  supportsFileSearch: boolean;
  slashCommands: AgentSlashCommand[];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
  searchFiles: (query: string) => Promise<AgentFileSearchResult[]>;
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
  supportsFileSearch,
  slashCommands,
  slashCommandsError,
  isSlashCommandsLoading,
  searchFiles,
}: AgentChatComposerEditorProps): ReactElement {
  const {
    filteredSlashCommands,
    activeSlashIndex,
    showSlashMenu,
    fileSearchResults,
    activeFileIndex,
    showFileMenu,
    fileSearchError,
    isFileSearchLoading,
    registerTextSegmentRef,
    focusLastTextSegment,
    focusSlashCommandSegment,
    focusFileReferenceSegment,
    selectSlashCommand,
    selectFileSearchResult,
    handleTextInput,
    handleTextBeforeInput,
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
    supportsFileSearch,
    slashCommands,
    searchFiles,
  });

  return (
    <div className="relative">
      {showFileMenu ? (
        <AgentChatComposerFileMenu
          results={fileSearchResults}
          activeIndex={activeFileIndex}
          fileSearchError={fileSearchError}
          isFileSearchLoading={isFileSearchLoading}
          onSelectFile={selectFileSearchResult}
        />
      ) : null}

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

        <div className="relative z-10 min-h-7 whitespace-pre-wrap break-words">
          {draft.segments.map((segment, index) => {
            const nextSegment = draft.segments[index + 1];

            if (segment.kind === "file_reference") {
              return (
                <TooltipProvider key={segment.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        contentEditable={false}
                        title={segment.file.path}
                        aria-label={`File reference ${segment.file.path}. Press Backspace immediately after the chip to remove it.`}
                        className={cn(
                          badgeVariants({ variant: "secondary" }),
                          "mr-2 inline-flex h-6 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-medium align-baseline",
                        )}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => focusFileReferenceSegment(segment.id)}
                      >
                        <AgentChatFileReferenceIcon kind={segment.file.kind} />
                        <span className="truncate">{segment.file.name}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent sideOffset={6}>{segment.file.path}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            }

            if (segment.kind === "slash_command") {
              return (
                <button
                  key={segment.id}
                  type="button"
                  contentEditable={false}
                  aria-label={`Slash command /${segment.command.trigger}. Press Backspace immediately after the chip to remove it.`}
                  className={cn(
                    badgeVariants({ variant: "secondary" }),
                    "mx-0.5 inline-flex h-6 align-baseline rounded-full border border-border px-2.5 text-xs font-medium mr-2",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => focusSlashCommandSegment(segment.id)}
                >
                  /{segment.command.trigger}
                </button>
              );
            }

            const segmentText = segment.text.trim();

            const isLeadingEmptyChipHost =
              segmentText.length === 0 && nextSegment != null && nextSegment.kind !== "text";
            if (isLeadingEmptyChipHost) {
              return null;
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
                className={cn(
                  "whitespace-pre-wrap break-words align-baseline outline-none",
                  segmentText.length === 0 && draft.segments[index - 1]?.kind !== "text"
                    ? "inline-block min-w-[1px]"
                    : "inline",
                )}
                onBeforeInput={(event) => handleTextBeforeInput(segment.id, event)}
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
