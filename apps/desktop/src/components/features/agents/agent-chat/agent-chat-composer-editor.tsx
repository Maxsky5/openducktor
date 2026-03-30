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

  if (
    target.closest(
      '[contenteditable="true"],[data-chip-segment-id],button,a,input,textarea,select,[role="button"]',
    )
  ) {
    return false;
  }

  return true;
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
    selectSlashCommand,
    selectFileSearchResult,
    handleEditorInput,
    handleEditorBeforeInput,
    handleEditorFocus,
    handleEditorClick,
    handleEditorKeyUp,
    handleEditorKeyDown,
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
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the contenteditable root is the editor surface. */}
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck={false}
        className={cn(
          "min-h-11 max-h-[220px] overflow-y-auto px-3 py-2.5 text-[15px] leading-6 outline-none",
          !draftHasMeaningfulContent(draft) &&
            "selection:bg-transparent [&_*::selection]:bg-transparent",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-text",
        )}
        aria-disabled={disabled}
        onBeforeInput={handleEditorBeforeInput}
        onInput={(event) => handleEditorInput(event.currentTarget)}
        onFocus={handleEditorFocus}
        onClick={handleEditorClick}
        onKeyUp={handleEditorKeyUp}
        onKeyDown={handleEditorKeyDown}
        onMouseDownCapture={(event) => {
          if (disabled || !shouldRedirectShellClickToComposer(event.target, event.currentTarget)) {
            return;
          }
          event.preventDefault();
          focusLastTextSegment();
        }}
      >
        {!draftHasMeaningfulContent(draft) ? (
          <div className="pointer-events-none absolute left-3 top-2.5 text-[15px] leading-6 text-muted-foreground">
            {placeholder}
          </div>
        ) : null}

        <div
          className={cn(
            "relative z-10 min-h-6 whitespace-pre-wrap break-words",
            !draftHasMeaningfulContent(draft) &&
              "selection:bg-transparent [&_*::selection]:bg-transparent",
          )}
          data-composer-content-root
        >
          {draft.segments.map((segment, index) => {
            const nextSegment = draft.segments[index + 1];

            if (segment.kind === "file_reference") {
              return (
                <TooltipProvider key={segment.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        contentEditable={false}
                        data-chip-segment-id={segment.id}
                        data-segment-id={segment.id}
                        title={segment.file.path}
                        className={cn(
                          badgeVariants({ variant: "secondary" }),
                          "mr-2 inline-flex h-6 bg-sky-300 dark:bg-sky-800 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium align-middle",
                        )}
                      >
                        <AgentChatFileReferenceIcon kind={segment.file.kind} />
                        <span className="truncate">{segment.file.name}</span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent sideOffset={6}>{segment.file.path}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            }

            if (segment.kind === "slash_command") {
              return (
                <span
                  key={segment.id}
                  contentEditable={false}
                  data-chip-segment-id={segment.id}
                  data-segment-id={segment.id}
                  className={cn(
                    badgeVariants({ variant: "secondary" }),
                    "mx-0.5 mr-2 inline-flex h-6 bg-yellow-300 dark:bg-yellow-600 items-center rounded-full px-2.5 text-xs font-medium align-middle",
                  )}
                >
                  /{segment.command.trigger}
                </span>
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
                data-segment-id={segment.id}
                data-text-segment-id={segment.id}
                className={cn(
                  "whitespace-pre-wrap break-words align-middle leading-6 outline-none",
                  segmentText.length === 0 && draft.segments[index - 1]?.kind !== "text"
                    ? "inline-block min-w-[1px]"
                    : "inline",
                )}
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
