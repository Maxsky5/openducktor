import type { AgentFileSearchResult, AgentSubagentReference } from "@openducktor/core";
import { Bot, ChevronRight, LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
  AgentChatComposerMenu,
  AgentChatComposerMenuEmptyState,
  AgentChatComposerMenuRow,
} from "./agent-chat-composer-menu";
import {
  getComposerPopupOptionId,
  resolveAgentChatComposerReferenceMenuVisibility,
} from "./agent-chat-composer-menu-state";
import { AgentChatFileReferenceIcon } from "./agent-chat-file-reference-icon";
import type { ReferenceMenuItem } from "./use-agent-chat-composer-editor-autocomplete";

type AgentChatComposerReferenceMenuProps = {
  listboxId: string;
  items: ReferenceMenuItem[];
  activeIndex: number;
  fileSearchError: string | null;
  isFileSearchPending: boolean;
  isFileSearchLoading: boolean;
  supportsSubagentReferences: boolean;
  subagentsError: string | null;
  isSubagentsLoading: boolean;
  onRetrySubagents: (() => void) | null;
  onSelectFile: (result: AgentFileSearchResult) => void;
  onSelectSubagent: (subagent: AgentSubagentReference) => void;
};

export function AgentChatComposerReferenceMenu({
  listboxId,
  items,
  activeIndex,
  fileSearchError,
  isFileSearchPending,
  isFileSearchLoading,
  supportsSubagentReferences,
  subagentsError,
  isSubagentsLoading,
  onRetrySubagents,
  onSelectFile,
  onSelectSubagent,
}: AgentChatComposerReferenceMenuProps): ReactElement | null {
  const { showSubagentsLoading, showFileSearchLoading, showEmptyState, shouldRenderMenu } =
    resolveAgentChatComposerReferenceMenuVisibility({
      itemCount: items.length,
      fileSearchError,
      isFileSearchPending,
      isFileSearchLoading,
      subagentsError,
      isSubagentsLoading,
    });

  if (!shouldRenderMenu) {
    return null;
  }

  return (
    <AgentChatComposerMenu
      listboxId={listboxId}
      label="References"
      activeIndex={activeIndex}
      items={items}
      isBusy={showSubagentsLoading || showFileSearchLoading}
      feedback={
        <>
          {showSubagentsLoading ? (
            <div
              role="status"
              className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm text-muted-foreground"
            >
              <LoaderCircle className="size-4 animate-spin" />
              <span>Loading subagents</span>
            </div>
          ) : null}
          {subagentsError ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-sm text-destructive"
            >
              <span className="min-w-0">{subagentsError}</span>
              {onRetrySubagents ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 px-2"
                  onClick={onRetrySubagents}
                >
                  Retry
                </Button>
              ) : null}
            </div>
          ) : null}
          {showFileSearchLoading ? (
            <div
              role="status"
              className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm text-muted-foreground"
            >
              <LoaderCircle className="size-4 animate-spin" />
              <span>Searching files</span>
            </div>
          ) : null}
          {fileSearchError ? (
            <div role="alert" className="border-b border-border px-3 py-2 text-sm text-destructive">
              {fileSearchError}
            </div>
          ) : null}
          {showEmptyState ? (
            <AgentChatComposerMenuEmptyState
              title={supportsSubagentReferences ? "No references found." : "No files found."}
            />
          ) : null}
        </>
      }
    >
      {items.map((item, index) => {
        const isActive = index === activeIndex;
        if (item.kind === "subagent") {
          return (
            <SubagentReferenceMenuRow
              key={item.id}
              optionId={getComposerPopupOptionId(listboxId, index)}
              subagent={item.subagent}
              isActive={isActive}
              onSelect={onSelectSubagent}
            />
          );
        }
        return (
          <FileReferenceMenuRow
            key={item.id}
            optionId={getComposerPopupOptionId(listboxId, index)}
            result={item.result}
            isActive={isActive}
            onSelect={onSelectFile}
          />
        );
      })}
    </AgentChatComposerMenu>
  );
}

type SubagentReferenceMenuRowProps = {
  optionId: string;
  subagent: AgentSubagentReference;
  isActive: boolean;
  onSelect: (subagent: AgentSubagentReference) => void;
};

function SubagentReferenceMenuRow({
  optionId,
  subagent,
  isActive,
  onSelect,
}: SubagentReferenceMenuRowProps): ReactElement {
  return (
    <AgentChatComposerMenuRow
      optionId={optionId}
      isActive={isActive}
      onSelect={() => onSelect(subagent)}
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
    </AgentChatComposerMenuRow>
  );
}

type FileReferenceMenuRowProps = {
  optionId: string;
  result: AgentFileSearchResult;
  isActive: boolean;
  onSelect: (result: AgentFileSearchResult) => void;
};

function FileReferenceMenuRow({
  optionId,
  result,
  isActive,
  onSelect,
}: FileReferenceMenuRowProps): ReactElement {
  return (
    <AgentChatComposerMenuRow
      optionId={optionId}
      isActive={isActive}
      onSelect={() => onSelect(result)}
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <AgentChatFileReferenceIcon kind={result.kind} className="text-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{result.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{result.path}</span>
      </span>
      <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    </AgentChatComposerMenuRow>
  );
}
