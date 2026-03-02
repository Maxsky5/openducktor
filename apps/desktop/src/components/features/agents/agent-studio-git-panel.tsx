import type { FileDiff } from "@openducktor/contracts";
import {
  AlignJustify,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  FileX,
  FolderGit2,
  MessageSquare,
  RefreshCw,
  Send,
  SplitSquareHorizontal,
} from "lucide-react";
import { memo, type ReactElement, useCallback, useMemo, useState } from "react";
import type { PierreDiffStyle } from "@/components/features/agents/pierre-diff-viewer";
import { PierreDiffViewer } from "@/components/features/agents/pierre-diff-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DiffDataState, DiffScope } from "@/pages/agents/use-agent-studio-diff-data";
import type { InlineCommentDraftStore } from "@/state/use-inline-comment-draft-store";
import { useInlineCommentDraftStore } from "@/state/use-inline-comment-draft-store";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type AgentStudioGitPanelModel = DiffDataState & {
  isCommitting?: boolean;
  isPushing?: boolean;
  isRebasing?: boolean;
  commitError?: string | null;
  pushError?: string | null;
  rebaseError?: string | null;
  commitAll?: (message: string) => Promise<void>;
  pushBranch?: () => Promise<void>;
  rebaseOntoTarget?: () => Promise<void>;
  onSendReview?: (message: string) => void;
};

// ─── File Status Helpers (hoisted outside component, rendering-hoist-jsx) ─────

const FILE_STATUS_ICON: Record<string, typeof FileText> = {
  modified: FileText,
  added: FilePlus,
  deleted: FileX,
};

const FILE_STATUS_COLOR: Record<string, string> = {
  modified: "text-blue-400",
  added: "text-green-400",
  deleted: "text-red-400",
};

const FILE_STATUS_BADGE: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
};

// ─── Zustand selectors (hoisted outside component, rerender-defer-reads) ──────

const selectDraftCount = (s: InlineCommentDraftStore): number => s.getDraftCount();
const selectFormatBatch = (s: InlineCommentDraftStore): (() => string) => s.formatBatchMessage;
const selectClearAll = (s: InlineCommentDraftStore): (() => void) => s.clearAll;

// ─── Sub-components ────────────────────────────────────────────────────────────

function GitInfoHeader({
  branch,
  worktreePath,
  targetBranch,
  commitsAheadBehind,
  diffScope,
  hasUncommittedFiles,
  isLoading,
  isCommitting,
  isPushing,
  isRebasing,
  commitError,
  pushError,
  rebaseError,
  commitAll,
  pushBranch,
  rebaseOntoTarget,
  setDiffScope,
  onRefresh,
}: Pick<
  AgentStudioGitPanelModel,
  | "branch"
  | "worktreePath"
  | "targetBranch"
  | "commitsAheadBehind"
  | "diffScope"
  | "isLoading"
  | "isCommitting"
  | "isPushing"
  | "isRebasing"
  | "commitError"
  | "pushError"
  | "rebaseError"
  | "setDiffScope"
> & {
  hasUncommittedFiles: boolean;
  commitAll: ((message: string) => Promise<void>) | null;
  pushBranch: (() => Promise<void>) | null;
  rebaseOntoTarget: (() => Promise<void>) | null;
  onRefresh: () => void;
}): ReactElement {
  const [commitMessage, setCommitMessage] = useState("");

  const trimmedTargetBranch = targetBranch.trim();
  const isDetachedHead = branch == null || branch.trim().length === 0;
  const hasTargetBranch = trimmedTargetBranch.length > 0;
  const isAnyActionInFlight = isCommitting || isPushing || isRebasing;
  const canRefresh = !isLoading && !isAnyActionInFlight;
  const canRebase =
    !isDetachedHead && hasTargetBranch && !isAnyActionInFlight && rebaseOntoTarget != null;
  const canPush = !isDetachedHead && !isAnyActionInFlight && pushBranch != null;
  const canCommit =
    commitAll != null &&
    !isAnyActionInFlight &&
    hasUncommittedFiles &&
    commitMessage.trim().length > 0;

  const handleScopeChange = (scope: DiffScope): void => {
    if (diffScope === scope) {
      return;
    }
    setDiffScope(scope);
  };

  const handleCommitSubmit = async (): Promise<void> => {
    if (!canCommit || commitAll == null) {
      return;
    }
    await commitAll(commitMessage);
    setCommitMessage("");
  };

  return (
    <div className="space-y-2 border-b border-border p-3">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <div
          className="flex min-w-0 items-center gap-3"
          data-testid="agent-studio-git-branch-context-row"
        >
          <div className="inline-flex items-center gap-1.5">
            <span className="font-medium text-foreground">Current</span>
            <span className="truncate font-mono" data-testid="agent-studio-git-current-branch">
              {branch ?? "Detached HEAD"}
            </span>
          </div>
          <div className="inline-flex items-center gap-1.5">
            <span className="font-medium text-foreground">Target</span>
            <span className="truncate font-mono" data-testid="agent-studio-git-target-branch">
              {hasTargetBranch ? targetBranch : "Not configured"}
            </span>
          </div>
        </div>
        {commitsAheadBehind ? (
          <div className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1">
            <span
              className="inline-flex items-center gap-0.5 text-green-400"
              data-testid="agent-studio-git-ahead-count"
            >
              <ArrowUp className="size-3" />
              {commitsAheadBehind.ahead}
            </span>
            <span
              className="inline-flex items-center gap-0.5 text-red-400"
              data-testid="agent-studio-git-behind-count"
            >
              <ArrowDown className="size-3" />
              {commitsAheadBehind.behind}
            </span>
          </div>
        ) : null}
      </div>

      {worktreePath ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <p className="truncate text-xs text-muted-foreground">{worktreePath}</p>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p className="font-mono text-xs">{worktreePath}</p>
          </TooltipContent>
        </Tooltip>
      ) : null}

      <div className="flex flex-wrap items-center gap-2" data-testid="agent-studio-git-action-row">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          onClick={onRefresh}
          disabled={!canRefresh}
          data-testid="agent-studio-git-refresh-button"
        >
          <RefreshCw className={cn("size-3.5", isLoading ? "animate-spin" : "")} />
          Refresh
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => void rebaseOntoTarget?.()}
          disabled={!canRebase}
          data-testid="agent-studio-git-rebase-button"
        >
          {isRebasing ? "Rebasing..." : "Rebase onto target"}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs"
          onClick={() => void pushBranch?.()}
          disabled={!canPush}
          data-testid="agent-studio-git-push-button"
        >
          {isPushing ? "Pushing..." : "Push"}
        </Button>
      </div>

      <div className="inline-flex h-8 items-center rounded-md border border-border bg-muted p-1">
        <button
          type="button"
          className={cn(
            "rounded-sm px-2 py-1 text-xs transition-colors",
            diffScope === "target" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
          )}
          onClick={() => handleScopeChange("target")}
          data-testid="agent-studio-git-diff-scope-target"
        >
          Target branch
        </button>
        <button
          type="button"
          className={cn(
            "rounded-sm px-2 py-1 text-xs transition-colors",
            diffScope === "uncommitted"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground",
          )}
          onClick={() => handleScopeChange("uncommitted")}
          data-testid="agent-studio-git-diff-scope-uncommitted"
        >
          Uncommitted
        </button>
      </div>

      <div
        className="space-y-2 rounded-md border border-border bg-card p-2"
        data-testid="agent-studio-git-commit-form"
      >
        <Textarea
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.currentTarget.value)}
          placeholder="Write commit message"
          className="min-h-20"
          disabled={isAnyActionInFlight || commitAll == null}
          data-testid="agent-studio-git-commit-message-input"
        />
        <Button
          type="button"
          size="sm"
          className="h-8 text-xs"
          onClick={() => void handleCommitSubmit()}
          disabled={!canCommit}
          data-testid="agent-studio-git-commit-submit-button"
        >
          {isCommitting ? "Committing..." : "Commit all"}
        </Button>
      </div>

      {commitError ? (
        <p className="text-xs text-destructive" data-testid="agent-studio-git-commit-error">
          {commitError}
        </p>
      ) : null}
      {rebaseError ? (
        <p className="text-xs text-destructive" data-testid="agent-studio-git-rebase-error">
          {rebaseError}
        </p>
      ) : null}
      {pushError ? (
        <p className="text-xs text-destructive" data-testid="agent-studio-git-push-error">
          {pushError}
        </p>
      ) : null}
    </div>
  );
}

function FileDiffEntry({
  diff,
  isExpanded,
  onToggle,
  diffStyle,
}: {
  diff: FileDiff;
  isExpanded: boolean;
  onToggle: () => void;
  diffStyle: PierreDiffStyle;
}): ReactElement {
  const StatusIcon = FILE_STATUS_ICON[diff.type] ?? FileText;
  const statusColor = FILE_STATUS_COLOR[diff.type] ?? "text-muted-foreground";
  const statusBadge = FILE_STATUS_BADGE[diff.type] ?? "?";

  const fileName = diff.file.split("/").pop() ?? diff.file;
  const dirName = diff.file.includes("/") ? diff.file.slice(0, diff.file.lastIndexOf("/")) : "";

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        {isExpanded ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        )}
        <StatusIcon className={cn("size-3.5 shrink-0", statusColor)} />
        <span className="flex-1 truncate">
          {dirName ? <span className="text-muted-foreground">{dirName}/</span> : null}
          <span className="font-medium">{fileName}</span>
        </span>
        <Badge
          variant="outline"
          className={cn("ml-auto px-1 py-0 text-[10px] font-mono", statusColor)}
        >
          {statusBadge}
        </Badge>
        <span className="flex items-center gap-1 text-[10px] font-mono">
          {diff.additions > 0 ? <span className="text-green-400">+{diff.additions}</span> : null}
          {diff.deletions > 0 ? <span className="text-red-400">-{diff.deletions}</span> : null}
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-border/50">
          {diff.diff && diff.diff.trim().length > 0 ? (
            <PierreDiffViewer patch={diff.diff} diffStyle={diffStyle} />
          ) : (
            <div className="p-3 text-xs text-muted-foreground italic">
              No diff content available for {diff.file}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// (Custom DiffContent removed — replaced by Pierre PierreDiffViewer)

/** Empty state shown when no files changed yet. */
function EmptyDiffState({ isLoading }: { isLoading: boolean }): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted/60">
        <FolderGit2 className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">
          {isLoading ? "Scanning for changes…" : "No changes detected"}
        </p>
        <p className="text-xs text-muted-foreground/70">
          {isLoading
            ? "Checking the working directory for file modifications."
            : "File modifications will appear here once the agent starts editing."}
        </p>
      </div>
    </div>
  );
}

function ReviewActions({
  onSendReview,
}: {
  onSendReview: (message: string) => void;
}): ReactElement | null {
  // Hoisted selectors — stable references (rerender-defer-reads)
  const draftCount = useInlineCommentDraftStore(selectDraftCount);
  const formatBatch = useInlineCommentDraftStore(selectFormatBatch);
  const clearAll = useInlineCommentDraftStore(selectClearAll);

  if (draftCount === 0) {
    return null;
  }

  const handleSend = (): void => {
    const message = formatBatch();
    if (message.trim().length > 0) {
      onSendReview(message);
      clearAll();
    }
  };

  return (
    <div className="flex items-center justify-between border-t border-border p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MessageSquare className="size-3.5" />
        <span>
          {draftCount} pending comment{draftCount > 1 ? "s" : ""}
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="default"
        className="h-7 gap-1.5 text-xs"
        onClick={handleSend}
      >
        <Send className="size-3" />
        Send Review
      </Button>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export const AgentStudioGitPanel = memo(function AgentStudioGitPanel({
  model,
}: {
  model: AgentStudioGitPanelModel;
}): ReactElement {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [diffStyle, setDiffStyle] = useState<PierreDiffStyle>("unified");
  const hasUncommittedFiles = model.fileStatuses.length > 0;

  // Stable callback (rerender-functional-setstate)
  const toggleFile = useCallback((filePath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const hasFiles = model.fileDiffs.length > 0;

  // Memoize aggregate stats to avoid repeated reduce calls (js-cache-function-results)
  const { totalAdditions, totalDeletions } = useMemo(() => {
    let adds = 0;
    let dels = 0;
    for (const f of model.fileDiffs) {
      adds += f.additions;
      dels += f.deletions;
    }
    return { totalAdditions: adds, totalDeletions: dels };
  }, [model.fileDiffs]);

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <GitInfoHeader
          branch={model.branch}
          worktreePath={model.worktreePath}
          targetBranch={model.targetBranch}
          diffScope={model.diffScope}
          hasUncommittedFiles={hasUncommittedFiles}
          commitsAheadBehind={model.commitsAheadBehind}
          isLoading={model.isLoading}
          isCommitting={model.isCommitting ?? false}
          isPushing={model.isPushing ?? false}
          isRebasing={model.isRebasing ?? false}
          commitError={model.commitError ?? null}
          pushError={model.pushError ?? null}
          rebaseError={model.rebaseError ?? null}
          commitAll={model.commitAll ?? null}
          pushBranch={model.pushBranch ?? null}
          rebaseOntoTarget={model.rebaseOntoTarget ?? null}
          setDiffScope={model.setDiffScope}
          onRefresh={model.refresh}
        />

        {model.error ? (
          <div className="border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {model.error}
          </div>
        ) : null}

        <ScrollArea className="flex-1 min-h-0">
          {hasFiles ? (
            <div className="divide-y divide-border/50">
              <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
                <span>
                  {model.fileDiffs.length} changed file{model.fileDiffs.length > 1 ? "s" : ""}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono">
                    {totalAdditions > 0 ? (
                      <span className="text-green-400 mr-1.5">+{totalAdditions}</span>
                    ) : null}
                    {totalDeletions > 0 ? (
                      <span className="text-red-400">-{totalDeletions}</span>
                    ) : null}
                  </span>
                  <div className="flex items-center border border-border/50 rounded-md overflow-hidden">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "p-1 transition-colors",
                            diffStyle === "split"
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          onClick={() => setDiffStyle("split")}
                        >
                          <SplitSquareHorizontal className="size-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p>Side-by-side</p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "p-1 transition-colors",
                            diffStyle === "unified"
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          onClick={() => setDiffStyle("unified")}
                        >
                          <AlignJustify className="size-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p>Unified</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>

              {model.fileDiffs.map((diff) => (
                <FileDiffEntry
                  key={diff.file}
                  diff={diff}
                  isExpanded={expandedFiles.has(diff.file)}
                  onToggle={() => toggleFile(diff.file)}
                  diffStyle={diffStyle}
                />
              ))}
            </div>
          ) : (
            <EmptyDiffState isLoading={model.isLoading} />
          )}
        </ScrollArea>

        {model.onSendReview != null ? <ReviewActions onSendReview={model.onSendReview} /> : null}
      </div>
    </TooltipProvider>
  );
});
