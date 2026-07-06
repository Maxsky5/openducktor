import type { AgentFileSearchResult, AgentSubagentReference } from "@openducktor/core";
import { Bot, ChevronRight, LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { AgentChatFileReferenceIcon } from "./agent-chat-file-reference-icon";
import type { ReferenceMenuItem } from "./use-agent-chat-composer-editor-autocomplete";

type AgentChatComposerReferenceMenuProps = {
  items: ReferenceMenuItem[];
  activeIndex: number;
  fileSearchError: string | null;
  isFileSearchPending: boolean;
  isFileSearchLoading: boolean;
  supportsSubagentReferences: boolean;
  subagentsError: string | null;
  isSubagentsLoading: boolean;
  onSelectFile: (result: AgentFileSearchResult) => void;
  onSelectSubagent: (subagent: AgentSubagentReference) => void;
};

export function AgentChatComposerReferenceMenu({
  items,
  activeIndex,
  fileSearchError,
  isFileSearchPending,
  isFileSearchLoading,
  supportsSubagentReferences,
  subagentsError,
  isSubagentsLoading,
  onSelectFile,
  onSelectSubagent,
}: AgentChatComposerReferenceMenuProps): ReactElement | null {
  const hasResults = items.length > 0;
  const showFileSearchLoading = isFileSearchLoading && !hasResults;
  const showEmptyState =
    !hasResults &&
    !isFileSearchPending &&
    !isSubagentsLoading &&
    !fileSearchError &&
    !subagentsError;
  const shouldRenderMenu =
    hasResults ||
    showFileSearchLoading ||
    isSubagentsLoading ||
    Boolean(fileSearchError) ||
    Boolean(subagentsError) ||
    showEmptyState;

  if (!shouldRenderMenu) {
    return null;
  }

  return (
    <div className="absolute bottom-full z-20 mb-2 rounded-xl border border-border bg-popover shadow-lg">
      {isSubagentsLoading ? (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          <span>Loading subagents</span>
        </div>
      ) : null}
      {subagentsError ? (
        <div className="border-b border-border px-3 py-2 text-sm text-destructive">
          {subagentsError}
        </div>
      ) : null}
      {showFileSearchLoading ? (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          <span>Searching files</span>
        </div>
      ) : null}
      {fileSearchError ? (
        <div className="border-b border-border px-3 py-2 text-sm text-destructive">
          {fileSearchError}
        </div>
      ) : null}
      {showEmptyState ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          {supportsSubagentReferences ? "No references found." : "No files found."}
        </div>
      ) : null}
      {hasResults ? (
        <div className="hide-scrollbar flex max-h-64 flex-col overflow-y-auto rounded-xl">
          {items.map((item, index) => {
            const isActive = index === activeIndex;
            if (item.kind === "subagent") {
              return (
                <SubagentReferenceMenuRow
                  key={item.id}
                  subagent={item.subagent}
                  isActive={isActive}
                  onSelect={onSelectSubagent}
                />
              );
            }
            return (
              <FileReferenceMenuRow
                key={item.id}
                result={item.result}
                isActive={isActive}
                onSelect={onSelectFile}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

type SubagentReferenceMenuRowProps = {
  subagent: AgentSubagentReference;
  isActive: boolean;
  onSelect: (subagent: AgentSubagentReference) => void;
};

function SubagentReferenceMenuRow({
  subagent,
  isActive,
  onSelect,
}: SubagentReferenceMenuRowProps): ReactElement {
  return (
    <button
      ref={(element) => {
        scrollActiveReferenceRowIntoView(element, isActive);
      }}
      type="button"
      className={referenceMenuRowClassName(isActive)}
      onPointerDown={(event) => {
        event.preventDefault();
        onSelect(subagent);
      }}
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-200">
        <Bot className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">@{subagent.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {subagent.label ?? subagent.name}
        </span>
        {subagent.description ? (
          <span className="line-clamp-2 text-xs text-muted-foreground">{subagent.description}</span>
        ) : null}
      </span>
      <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

type FileReferenceMenuRowProps = {
  result: AgentFileSearchResult;
  isActive: boolean;
  onSelect: (result: AgentFileSearchResult) => void;
};

function FileReferenceMenuRow({
  result,
  isActive,
  onSelect,
}: FileReferenceMenuRowProps): ReactElement {
  return (
    <button
      ref={(element) => {
        scrollActiveReferenceRowIntoView(element, isActive);
      }}
      type="button"
      className={referenceMenuRowClassName(isActive)}
      onPointerDown={(event) => {
        event.preventDefault();
        onSelect(result);
      }}
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <AgentChatFileReferenceIcon kind={result.kind} className="text-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{result.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{result.path}</span>
      </span>
      <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function referenceMenuRowClassName(isActive: boolean): string {
  return cn(
    "flex w-full cursor-pointer gap-3 px-3 py-2 text-left transition-colors",
    isActive ? "bg-selected-surface" : "hover:bg-muted/80",
  );
}

function scrollActiveReferenceRowIntoView(
  element: HTMLButtonElement | null,
  isActive: boolean,
): void {
  if (!isActive) {
    return;
  }

  element?.scrollIntoView({
    block: "nearest",
    inline: "nearest",
  });
}
