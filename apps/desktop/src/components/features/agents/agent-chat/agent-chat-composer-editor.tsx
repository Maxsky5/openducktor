import type { AgentFileSearchResult, AgentSlashCommand } from "@openducktor/core";
import { type ReactElement, useLayoutEffect } from "react";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  type AgentChatComposerDraft,
  draftHasMeaningfulContent,
} from "./agent-chat-composer-draft";
import { AgentChatComposerFileMenu } from "./agent-chat-composer-file-menu";
import {
  EMPTY_TEXT_SEGMENT_SENTINEL,
  readEditableTextContent,
} from "./agent-chat-composer-selection";
import { AgentChatComposerSlashMenu } from "./agent-chat-composer-slash-menu";
import { AGENT_CHAT_FILE_REFERENCE_CHIP_BASE_CLASS_NAME } from "./agent-chat-file-reference-chip";
import { getAgentChatFileReferenceIconMarkup } from "./agent-chat-file-reference-icon";
import { useAgentChatComposerEditor } from "./use-agent-chat-composer-editor";

const escapeHtml = (value: string): string => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

const buildComposerContentMarkup = (draft: AgentChatComposerDraft): string => {
  return draft.segments
    .map((segment, index) => {
      const nextSegment = draft.segments[index + 1];

      if (segment.kind === "file_reference") {
        return `<span contenteditable="false" data-chip-segment-id="${escapeHtml(segment.id)}" data-segment-id="${escapeHtml(segment.id)}" title="${escapeHtml(segment.file.path)}" class="${escapeHtml(
          cn(AGENT_CHAT_FILE_REFERENCE_CHIP_BASE_CLASS_NAME, "mr-2 align-middle"),
        )}"><span class="inline-flex shrink-0">${getAgentChatFileReferenceIconMarkup(segment.file.kind)}</span><span class="truncate">${escapeHtml(segment.file.name)}</span></span>`;
      }

      if (segment.kind === "slash_command") {
        return `<span contenteditable="false" data-chip-segment-id="${escapeHtml(segment.id)}" data-segment-id="${escapeHtml(segment.id)}" class="${escapeHtml(
          cn(
            badgeVariants({ variant: "secondary" }),
            "mx-0.5 mr-2 inline-flex h-6 bg-yellow-300 dark:bg-yellow-600 items-center rounded-full px-2.5 text-xs font-medium align-middle",
          ),
        )}">/${escapeHtml(segment.command.trigger)}</span>`;
      }

      const segmentText = segment.text.trim();
      const isLeadingEmptyChipHost =
        segmentText.length === 0 && nextSegment != null && nextSegment.kind !== "text";
      if (isLeadingEmptyChipHost) {
        return "";
      }

      const className = cn(
        "whitespace-pre-wrap break-words align-middle leading-6 outline-none",
        segmentText.length === 0 && draft.segments[index - 1]?.kind !== "text"
          ? "inline-block min-w-[1px]"
          : "inline",
      );

      return `<span data-segment-id="${escapeHtml(segment.id)}" data-text-segment-id="${escapeHtml(segment.id)}" class="${escapeHtml(className)}">${
        segment.text.length > 0 ? escapeHtml(segment.text) : EMPTY_TEXT_SEGMENT_SENTINEL
      }</span>`;
    })
    .join("");
};

const shouldRenderTextSegment = (draft: AgentChatComposerDraft, index: number): boolean => {
  const segment = draft.segments[index];
  if (!segment || segment.kind !== "text") {
    return false;
  }

  const nextSegment = draft.segments[index + 1];
  return !(segment.text.trim().length === 0 && nextSegment != null && nextSegment.kind !== "text");
};

const readExpectedTextSegmentClassName = (
  draft: AgentChatComposerDraft,
  index: number,
): string | null => {
  const segment = draft.segments[index];
  if (!segment || segment.kind !== "text") {
    return null;
  }

  const segmentText = segment.text.trim();
  return cn(
    "whitespace-pre-wrap break-words align-middle leading-6 outline-none",
    segmentText.length === 0 && draft.segments[index - 1]?.kind !== "text"
      ? "inline-block min-w-[1px]"
      : "inline",
  );
};

const syncComposerDomInPlace = (root: HTMLDivElement, draft: AgentChatComposerDraft): boolean => {
  const domNodes = Array.from(root.childNodes).filter(
    (node) => !(node instanceof Text && (node.textContent ?? "").length === 0),
  );
  const renderableSegments = draft.segments.flatMap((segment, draftIndex) => {
    if (segment.kind === "text" && !shouldRenderTextSegment(draft, draftIndex)) {
      return [];
    }

    return [{ segment, draftIndex }];
  });

  if (domNodes.length !== renderableSegments.length) {
    return false;
  }

  return renderableSegments.every(({ segment, draftIndex }, index) => {
    const node = domNodes[index];
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    if (segment.kind === "text") {
      const expectedClassName = readExpectedTextSegmentClassName(draft, draftIndex);
      if (!expectedClassName) {
        return false;
      }

      if (node.className !== expectedClassName) {
        node.className = expectedClassName;
      }

      return (
        node.dataset.textSegmentId === segment.id &&
        readEditableTextContent(node) === segment.text &&
        node.className === expectedClassName
      );
    }

    if (segment.kind === "slash_command") {
      return (
        node.dataset.chipSegmentId === segment.id &&
        node.textContent === `/${segment.command.trigger}`
      );
    }

    return (
      node.dataset.chipSegmentId === segment.id &&
      node.getAttribute("title") === segment.file.path &&
      (node.textContent ?? "").includes(segment.file.name)
    );
  });
};

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
    editorRef,
    disabled,
    onEditorInput,
    onSend,
    supportsSlashCommands,
    supportsFileSearch,
    slashCommands,
    searchFiles,
  });
  const composerContentMarkup = buildComposerContentMarkup(draft);

  useLayoutEffect(() => {
    const editor = editorRef.current?.querySelector<HTMLDivElement>("[data-composer-content-root]");
    if (!editor || syncComposerDomInPlace(editor, draft)) {
      return;
    }
    editor.innerHTML = composerContentMarkup;
  }, [composerContentMarkup, draft, editorRef]);

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
        />
      </div>
    </div>
  );
}
