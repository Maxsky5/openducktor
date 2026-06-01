import type {
  AgentFileSearchResult,
  AgentSkillReference,
  AgentSlashCommand,
} from "@openducktor/core";
import { type ReactElement, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { badgeVariants } from "@/components/ui/badge-variants";
import { cn } from "@/lib/utils";
import {
  type AgentChatComposerDraft,
  draftHasMeaningfulContent,
} from "./agent-chat-composer-draft";
import { AgentChatComposerFileMenu } from "./agent-chat-composer-file-menu";
import {
  readEditableTextContent,
  renderEditableTextContent,
} from "./agent-chat-composer-selection";
import { AgentChatComposerSkillMenu } from "./agent-chat-composer-skill-menu";
import { AgentChatComposerSlashMenu } from "./agent-chat-composer-slash-menu";
import type { AgentChatFileReferenceChipFile } from "./agent-chat-file-reference-chip";
import {
  AGENT_CHAT_FILE_REFERENCE_CHIP_BASE_CLASS_NAME,
  AGENT_CHAT_FILE_REFERENCE_CHIP_ICON_CLASS_NAME,
  AGENT_CHAT_FILE_REFERENCE_CHIP_LABEL_CLASS_NAME,
} from "./agent-chat-file-reference-chip-classnames";
import { getAgentChatFileReferenceIconMarkup } from "./agent-chat-file-reference-icon";
import {
  AGENT_CHAT_SKILL_REFERENCE_CHIP_BASE_CLASS_NAME,
  AGENT_CHAT_SKILL_REFERENCE_CHIP_ICON_CLASS_NAME,
  AGENT_CHAT_SKILL_REFERENCE_CHIP_LABEL_CLASS_NAME,
  getAgentChatSkillReferenceIconMarkup,
} from "./agent-chat-skill-reference-chip-markup";
import { useAgentChatComposerEditor } from "./use-agent-chat-composer-editor";

const escapeHtml = (value: string): string => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

const buildComposerFileReferenceChipMarkup = (
  file: AgentChatFileReferenceChipFile,
  segmentId: string,
): string => {
  return `<span contenteditable="false" data-chip-segment-id="${escapeHtml(segmentId)}" data-segment-id="${escapeHtml(segmentId)}" data-file-reference-path="${escapeHtml(file.path)}" class="${escapeHtml(
    cn(AGENT_CHAT_FILE_REFERENCE_CHIP_BASE_CLASS_NAME, "mr-2 max-w-full align-middle"),
  )}"><span class="${escapeHtml(AGENT_CHAT_FILE_REFERENCE_CHIP_ICON_CLASS_NAME)}">${getAgentChatFileReferenceIconMarkup(
    file.kind,
  )}</span><span class="${escapeHtml(AGENT_CHAT_FILE_REFERENCE_CHIP_LABEL_CLASS_NAME)}">${escapeHtml(
    file.name,
  )}</span></span>`;
};

const buildComposerSkillReferenceChipMarkup = (
  skill: AgentSkillReference,
  segmentId: string,
): string => {
  return `<span contenteditable="false" data-chip-segment-id="${escapeHtml(segmentId)}" data-segment-id="${escapeHtml(segmentId)}" data-skill-reference-name="${escapeHtml(skill.name)}" class="${escapeHtml(
    cn(AGENT_CHAT_SKILL_REFERENCE_CHIP_BASE_CLASS_NAME, "mx-0.5 mr-2 max-w-48 align-middle"),
  )}"><span class="${escapeHtml(AGENT_CHAT_SKILL_REFERENCE_CHIP_ICON_CLASS_NAME)}">${getAgentChatSkillReferenceIconMarkup()}</span><span class="${escapeHtml(AGENT_CHAT_SKILL_REFERENCE_CHIP_LABEL_CLASS_NAME)}">${escapeHtml(skill.name)}</span></span>`;
};

const COMPOSER_FILE_REFERENCE_TOOLTIP_OFFSET = 8;
const COMPOSER_FILE_REFERENCE_TOOLTIP_TOP_MINIMUM = 40;
const COMPOSER_TEXT_SEGMENT_BASE_CLASS_NAME =
  "whitespace-pre-wrap break-words align-middle leading-6 outline-none";
const COMPOSER_TEXT_SEGMENT_TRAILING_LINE_CLASS_NAME =
  "after:inline-block after:h-6 after:w-px after:align-bottom after:content-['']";
type ComposerFileReferenceTooltipState = {
  path: string;
  left: number;
  top: number;
  side: "top" | "bottom";
};
type AgentChatComposerSegments = AgentChatComposerDraft["segments"];

const readComposerFileReferenceChipElement = (target: EventTarget | null): HTMLElement | null => {
  if (!(target instanceof Element)) {
    return null;
  }

  const chip = target.closest("[data-file-reference-path]");
  return chip instanceof HTMLElement ? chip : null;
};

const readComposerFileReferenceTooltipState = (
  target: EventTarget | null,
): ComposerFileReferenceTooltipState | null => {
  const chip = readComposerFileReferenceChipElement(target);
  const path = chip?.dataset.fileReferencePath;
  if (!chip || !path) {
    return null;
  }

  const chipBounds = chip.getBoundingClientRect();
  const side = chipBounds.top >= COMPOSER_FILE_REFERENCE_TOOLTIP_TOP_MINIMUM ? "top" : "bottom";

  return {
    path,
    left: chipBounds.left + chipBounds.width / 2,
    top:
      side === "top"
        ? chipBounds.top - COMPOSER_FILE_REFERENCE_TOOLTIP_OFFSET
        : chipBounds.bottom + COMPOSER_FILE_REFERENCE_TOOLTIP_OFFSET,
    side,
  };
};

const buildComposerContentMarkup = (segments: AgentChatComposerSegments): string => {
  return segments
    .map((segment, index) => {
      if (segment.kind === "file_reference") {
        return buildComposerFileReferenceChipMarkup(segment.file, segment.id);
      }

      if (segment.kind === "skill_mention") {
        return buildComposerSkillReferenceChipMarkup(segment.skill, segment.id);
      }

      if (segment.kind === "slash_command") {
        return `<span contenteditable="false" data-chip-segment-id="${escapeHtml(segment.id)}" data-segment-id="${escapeHtml(segment.id)}" class="${escapeHtml(
          cn(
            badgeVariants({ variant: "secondary" }),
            "mx-0.5 mr-2 inline-flex h-6 bg-yellow-300 dark:bg-yellow-600 items-center rounded-full px-2.5 text-xs font-medium align-middle",
          ),
        )}">/${escapeHtml(segment.command.trigger)}</span>`;
      }

      const className = readExpectedTextSegmentClassName(segments, index);

      return `<span data-segment-id="${escapeHtml(segment.id)}" data-text-segment-id="${escapeHtml(segment.id)}" class="${escapeHtml(className)}">${escapeHtml(
        renderEditableTextContent(segment.text),
      )}</span>`;
    })
    .join("");
};

const shouldRenderTextSegment = (segments: AgentChatComposerSegments, index: number): boolean => {
  const segment = segments[index];
  if (segment?.kind !== "text") {
    return false;
  }

  return true;
};

const readExpectedTextSegmentClassName = (
  segments: AgentChatComposerSegments,
  index: number,
): string => {
  const segment = segments[index];
  if (segment?.kind !== "text") {
    throw new Error("Expected composer text segment when reading class name.");
  }

  const segmentText = segment.text.trim();
  const hasTrailingBlankLine = segment.text.endsWith("\n");
  const isEmptyAdjacentToChip =
    segmentText.length === 0 &&
    !hasTrailingBlankLine &&
    (segments[index - 1]?.kind !== "text" || segments[index + 1]?.kind !== "text");
  return cn(
    COMPOSER_TEXT_SEGMENT_BASE_CLASS_NAME,
    isEmptyAdjacentToChip ? "inline-block min-w-[1px]" : "inline",
    hasTrailingBlankLine && COMPOSER_TEXT_SEGMENT_TRAILING_LINE_CLASS_NAME,
  );
};

const syncComposerDomInPlace = (
  root: HTMLDivElement,
  segments: AgentChatComposerSegments,
): boolean => {
  const domNodes = Array.from(root.childNodes).filter(
    (node) => !(node instanceof Text && (node.textContent ?? "").length === 0),
  );
  const renderableSegments = segments.reduce<
    Array<{ segment: AgentChatComposerSegments[number]; draftIndex: number }>
  >((currentSegments, segment, draftIndex) => {
    if (segment.kind === "text" && !shouldRenderTextSegment(segments, draftIndex)) {
      return currentSegments;
    }

    currentSegments.push({ segment, draftIndex });
    return currentSegments;
  }, []);

  return (
    domNodes.length === renderableSegments.length &&
    renderableSegments.every(({ segment, draftIndex }, index) => {
      const node = domNodes[index];
      if (!(node instanceof HTMLElement)) {
        return false;
      }

      if (segment.kind === "text") {
        const expectedClassName = readExpectedTextSegmentClassName(segments, draftIndex);

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

      if (segment.kind === "skill_mention") {
        return (
          node.dataset.chipSegmentId === segment.id &&
          node.dataset.skillReferenceName === segment.skill.name &&
          node.textContent === segment.skill.name
        );
      }

      return (
        node.dataset.chipSegmentId === segment.id &&
        node.dataset.fileReferencePath === segment.file.path &&
        (node.textContent ?? "").includes(segment.file.name)
      );
    })
  );
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
  onAddFiles: (files: File[]) => void;
  placeholder: string;
  disabled: boolean;
  editorRef: React.RefObject<HTMLDivElement | null>;
  onEditorInput: () => void;
  onSend: () => void;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  supportsSkillReferences: boolean;
  slashCommands: AgentSlashCommand[];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
  skills: AgentSkillReference[];
  skillsError: string | null;
  isSkillsLoading: boolean;
  searchFiles: (query: string) => Promise<AgentFileSearchResult[]>;
};

export function AgentChatComposerEditor({
  draft,
  onDraftChange,
  onAddFiles,
  placeholder,
  disabled,
  editorRef,
  onEditorInput,
  onSend,
  supportsSlashCommands,
  supportsFileSearch,
  supportsSkillReferences,
  slashCommands,
  slashCommandsError,
  isSlashCommandsLoading,
  skills,
  skillsError,
  isSkillsLoading,
  searchFiles,
}: AgentChatComposerEditorProps): ReactElement {
  const [composerFileReferenceTooltip, setComposerFileReferenceTooltip] =
    useState<ComposerFileReferenceTooltipState | null>(null);
  const {
    filteredSlashCommands,
    activeSlashIndex,
    filteredSkills,
    activeSkillIndex,
    showSlashMenu,
    showSkillMenu,
    fileSearchResults,
    activeFileIndex,
    showFileMenu,
    fileSearchError,
    isFileSearchLoading,
    focusLastTextSegment,
    selectSlashCommand,
    selectSkillReference,
    selectFileSearchResult,
    handleEditorInput,
    handleEditorBeforeInput,
    handleEditorPaste,
    handleEditorFocus,
    handleEditorClick,
    handleEditorKeyUp,
    handleEditorKeyDown,
  } = useAgentChatComposerEditor({
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
    slashCommands,
    skills,
    searchFiles,
  });
  const draftSegments = draft.segments;
  const composerContentMarkup = useMemo(
    () => buildComposerContentMarkup(draftSegments),
    [draftSegments],
  );

  useLayoutEffect(() => {
    const editor = editorRef.current?.querySelector<HTMLDivElement>("[data-composer-content-root]");
    if (!editor || syncComposerDomInPlace(editor, draftSegments)) {
      return;
    }
    editor.innerHTML = composerContentMarkup;
  }, [composerContentMarkup, draftSegments, editorRef]);

  useLayoutEffect(() => {
    if (!composerFileReferenceTooltip) {
      return;
    }

    const hideTooltip = (): void => {
      setComposerFileReferenceTooltip(null);
    };

    window.addEventListener("resize", hideTooltip);
    window.addEventListener("scroll", hideTooltip, true);
    return () => {
      window.removeEventListener("resize", hideTooltip);
      window.removeEventListener("scroll", hideTooltip, true);
    };
  }, [composerFileReferenceTooltip]);

  return (
    <div className="relative">
      {composerFileReferenceTooltip
        ? createPortal(
            <div
              className={cn(
                "pointer-events-none fixed z-50 max-w-80 rounded-md bg-foreground px-3 py-1.5 text-xs text-background text-balance shadow-sm",
                composerFileReferenceTooltip.side === "top"
                  ? "-translate-x-1/2 -translate-y-full"
                  : "-translate-x-1/2",
              )}
              style={{
                left: `${composerFileReferenceTooltip.left}px`,
                top: `${composerFileReferenceTooltip.top}px`,
              }}
            >
              <div>{composerFileReferenceTooltip.path}</div>
              <div
                className={cn(
                  "absolute left-1/2 size-2.5 -translate-x-1/2 rotate-45 bg-foreground",
                  composerFileReferenceTooltip.side === "top"
                    ? "bottom-0 translate-y-1/2"
                    : "top-0 -translate-y-1/2",
                )}
              />
            </div>,
            document.body,
          )
        : null}
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
      {showSkillMenu ? (
        <AgentChatComposerSkillMenu
          skills={filteredSkills}
          activeIndex={activeSkillIndex}
          skillsError={skillsError}
          isSkillsLoading={isSkillsLoading}
          onSelectSkill={selectSkillReference}
        />
      ) : null}
      {/* biome-ignore lint/a11y/useSemanticElements: the contenteditable root supports inline chips and file references. */}
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        tabIndex={disabled ? -1 : 0}
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
        onPaste={handleEditorPaste}
        onInput={(event) => handleEditorInput(event.currentTarget)}
        onFocus={handleEditorFocus}
        onClick={handleEditorClick}
        onKeyUp={handleEditorKeyUp}
        onKeyDown={handleEditorKeyDown}
        onMouseOver={(event) => {
          const nextTooltip = readComposerFileReferenceTooltipState(event.target);
          if (!nextTooltip) {
            return;
          }

          setComposerFileReferenceTooltip((current) => {
            if (
              current?.path === nextTooltip.path &&
              current.left === nextTooltip.left &&
              current.top === nextTooltip.top &&
              current.side === nextTooltip.side
            ) {
              return current;
            }

            return nextTooltip;
          });
        }}
        onMouseOut={(event) => {
          const currentChip = readComposerFileReferenceChipElement(event.target);
          if (!currentChip) {
            return;
          }

          const nextChip = readComposerFileReferenceChipElement(event.relatedTarget);
          if (currentChip === nextChip) {
            return;
          }

          setComposerFileReferenceTooltip(null);
        }}
        onBlur={() => {
          setComposerFileReferenceTooltip(null);
        }}
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
