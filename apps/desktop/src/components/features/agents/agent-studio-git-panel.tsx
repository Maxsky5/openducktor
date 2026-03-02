import type { FileDiff } from "@openducktor/contracts";
import {
  AlignJustify,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  FileX,
  FolderGit2,
  GitBranch,
  MessageSquare,
  RefreshCw,
  Send,
  SplitSquareHorizontal,
  Target,
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
  pullFromUpstream?: () => Promise<void>;
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

const DIFF_SCOPE_OPTIONS: Array<{
  scope: DiffScope;
  label: string;
  testId: string;
}> = [
  {
    scope: "uncommitted",
    label: "Uncommitted changes",
    testId: "agent-studio-git-diff-scope-uncommitted",
  },
  {
    scope: "target",
    label: "Compare to target",
    testId: "agent-studio-git-diff-scope-target",
  },
];

// ─── Sub-components ────────────────────────────────────────────────────────────

function GitInfoHeader({
  branch,
  targetBranch,
  commitsAheadBehind,
  upstreamAheadBehind,
  diffScope,
  uncommittedFileCount,
  isLoading,
  isCommitting,
  isPushing,
  isRebasing,
  pushError,
  rebaseError,
  pushBranch,
  rebaseOntoTarget,
  pullFromUpstream,
  setDiffScope,
  onRefresh,
}: Pick<
  AgentStudioGitPanelModel,
  | "branch"
  | "targetBranch"
  | "commitsAheadBehind"
  | "upstreamAheadBehind"
  | "diffScope"
  | "isLoading"
  | "isCommitting"
  | "isPushing"
  | "isRebasing"
  | "pushError"
  | "rebaseError"
  | "setDiffScope"
> & {
  uncommittedFileCount: number;
  pushBranch: (() => Promise<void>) | null;
  rebaseOntoTarget: (() => Promise<void>) | null;
  pullFromUpstream: (() => Promise<void>) | null;
  onRefresh: () => void;
}): ReactElement {
  const trimmedTargetBranch = targetBranch.trim();
  const isDetachedHead = branch == null || branch.trim().length === 0;
  const currentBranchLabel = isDetachedHead ? "Detached HEAD" : branch;
  const hasTargetBranch = trimmedTargetBranch.length > 0;
  const targetBranchLabel = hasTargetBranch ? targetBranch : "No comparison target";
  const rebaseBehindCount = commitsAheadBehind?.behind ?? null;
  const pushAheadCount = upstreamAheadBehind?.ahead ?? null;
  const pushBehindCount = upstreamAheadBehind?.behind ?? null;
  const hasUncommittedFiles = uncommittedFileCount > 0;
  const hasUpstreamBehind = pushBehindCount != null && pushBehindCount > 0;
  const isAnyActionInFlight = isCommitting || isPushing || isRebasing;
  const pushBlockedByBehind = hasUpstreamBehind;
  const canRefresh = !isLoading && !isAnyActionInFlight;
  const canRebase =
    !isDetachedHead && hasTargetBranch && !isAnyActionInFlight && rebaseOntoTarget != null;
  const canPull =
    !isDetachedHead &&
    hasUpstreamBehind &&
    !hasUncommittedFiles &&
    !isAnyActionInFlight &&
    pullFromUpstream != null;
  const canPush =
    !isDetachedHead && !pushBlockedByBehind && !isAnyActionInFlight && pushBranch != null;

  const handleScopeChange = (scope: string): void => {
    if (scope !== "target" && scope !== "uncommitted") {
      return;
    }
    if (diffScope === scope) {
      return;
    }
    setDiffScope(scope);
  };

  return (
    <div className="space-y-3 border-b border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Branch context
        </span>
        <Badge variant="outline" className="px-2 py-0.5 text-[10px]">
          {uncommittedFileCount} file{uncommittedFileCount === 1 ? "" : "s"} changed
        </Badge>
      </div>

      <div
        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center"
        data-testid="agent-studio-git-branch-context-row"
      >
        <div className="rounded-lg border border-border bg-card px-3 py-2">
          <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Current branch
          </p>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
            <span
              className="truncate font-mono text-xs text-foreground"
              data-testid="agent-studio-git-current-branch"
            >
              {currentBranchLabel}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-center" aria-hidden="true">
          <span className="inline-flex size-7 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
            <ArrowRight className="size-3.5" />
          </span>
        </div>

        <div className="rounded-lg border border-border bg-card px-3 py-2">
          <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Comparison target
          </p>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <Target className="size-3.5 shrink-0 text-muted-foreground" />
            <span
              className="truncate font-mono text-xs text-foreground"
              data-testid="agent-studio-git-target-branch"
            >
              {targetBranchLabel}
            </span>
          </div>
        </div>
      </div>

      <div
        className="flex items-center justify-between gap-2 border-y border-border py-1"
        data-testid="agent-studio-git-action-row"
      >
        <div className="inline-flex items-center gap-0.5 px-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-9 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-auto disabled:cursor-not-allowed"
                onClick={onRefresh}
                disabled={!canRefresh}
                data-testid="agent-studio-git-refresh-button"
              >
                <RefreshCw className={cn("size-3.5", isLoading ? "animate-spin" : "")} />
                <span className="sr-only">Refresh</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{isLoading ? "Refreshing" : "Refresh changes"}</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="relative size-9 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-auto disabled:cursor-not-allowed"
                onClick={() => void rebaseOntoTarget?.()}
                disabled={!canRebase}
                data-testid="agent-studio-git-rebase-button"
              >
                <Target className="size-3.5" />
                {rebaseBehindCount != null && rebaseBehindCount > 0 ? (
                  <span
                    className="pointer-events-none absolute top-1 right-1 text-[11px] leading-none font-bold tabular-nums text-rose-600 dark:text-rose-400"
                    data-testid="agent-studio-git-behind-count"
                  >
                    {rebaseBehindCount}
                  </span>
                ) : null}
                <span className="sr-only">Rebase onto target</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>
                {isRebasing
                  ? "Rebasing"
                  : rebaseBehindCount != null && rebaseBehindCount > 0
                    ? `Rebase onto target (${rebaseBehindCount} behind)`
                    : "Rebase onto target"}
              </p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex" data-testid="agent-studio-git-pull-tooltip-trigger">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="relative size-9 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-auto disabled:cursor-not-allowed"
                  onClick={() => void pullFromUpstream?.()}
                  disabled={!canPull}
                  data-testid="agent-studio-git-pull-button"
                >
                  <ArrowDown className="size-3.5" />
                  {pushBehindCount != null && pushBehindCount > 0 ? (
                    <span
                      className="pointer-events-none absolute top-1 right-1 text-[11px] leading-none font-bold tabular-nums text-rose-600 dark:text-rose-400"
                      data-testid="agent-studio-git-upstream-behind-count"
                    >
                      {pushBehindCount}
                    </span>
                  ) : null}
                  <span className="sr-only">Pull from upstream</span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>
                {isRebasing
                  ? "Pulling"
                  : hasUncommittedFiles
                    ? "Commit or stash changes before pulling"
                    : pushBehindCount != null && pushBehindCount > 0
                      ? `Pull (${pushBehindCount} behind)`
                      : "Pull"}
              </p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="relative size-9 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-auto disabled:cursor-not-allowed"
                onClick={() => void pushBranch?.()}
                disabled={!canPush}
                data-testid="agent-studio-git-push-button"
              >
                <ArrowUp className="size-3.5" />
                {pushAheadCount != null && pushAheadCount > 0 ? (
                  <span
                    className="pointer-events-none absolute top-1 right-1 text-[11px] leading-none font-bold tabular-nums text-emerald-600 dark:text-emerald-400"
                    data-testid="agent-studio-git-ahead-count"
                  >
                    {pushAheadCount}
                  </span>
                ) : null}
                <span className="sr-only">Push branch</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>
                {isPushing
                  ? "Pushing"
                  : pushBlockedByBehind && hasUncommittedFiles
                    ? "Commit or stash changes, then pull before pushing"
                    : pushBlockedByBehind
                      ? "Pull before pushing"
                      : pushAheadCount != null && pushAheadCount > 0
                        ? `Push branch (${pushAheadCount} ahead)`
                        : "Push branch"}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          Diff scope
        </p>
        <div
          className="inline-flex h-9 w-full items-center rounded-md border border-border bg-muted p-1"
          role="tablist"
          aria-label="Git diff scope"
        >
          {DIFF_SCOPE_OPTIONS.map((option) => {
            const isActive = diffScope === option.scope;
            return (
              <button
                key={option.scope}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={cn(
                  "inline-flex h-7 flex-1 items-center justify-center rounded-sm px-3 text-xs transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/80 hover:text-foreground",
                )}
                onClick={() => handleScopeChange(option.scope)}
                data-testid={option.testId}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

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

function CommitComposer({
  hasUncommittedFiles,
  uncommittedFileCount,
  isCommitting,
  isPushing,
  isRebasing,
  commitError,
  commitAll,
}: {
  hasUncommittedFiles: boolean;
  uncommittedFileCount: number;
  isCommitting: boolean;
  isPushing: boolean;
  isRebasing: boolean;
  commitError: string | null;
  commitAll: ((message: string) => Promise<void>) | null;
}): ReactElement {
  const [commitMessage, setCommitMessage] = useState("");
  const isAnyActionInFlight = isCommitting || isPushing || isRebasing;
  const canWrite = commitAll != null && !isAnyActionInFlight;
  const canCommit = canWrite && hasUncommittedFiles && commitMessage.trim().length > 0;

  const handleCommitSubmit = async (): Promise<void> => {
    if (!canCommit || commitAll == null) {
      return;
    }
    await commitAll(commitMessage);
    setCommitMessage("");
  };

  return (
    <div
      className="space-y-3 border-t border-sidebar-border bg-sidebar p-3"
      data-testid="agent-studio-git-commit-form"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-sidebar-foreground">Commit all changes</p>
          <p className="text-[11px] text-sidebar-foreground/70">
            One message for every uncommitted file in this workspace.
          </p>
        </div>
        <Badge variant="outline" className="px-2 py-0.5 text-[10px]">
          {uncommittedFileCount} file{uncommittedFileCount === 1 ? "" : "s"}
        </Badge>
      </div>

      <Textarea
        value={commitMessage}
        onChange={(event) => setCommitMessage(event.currentTarget.value)}
        placeholder={
          hasUncommittedFiles ? "Describe what changed and why" : "No uncommitted files to commit"
        }
        className="min-h-20 resize-none border-input"
        disabled={!canWrite}
        data-testid="agent-studio-git-commit-message-input"
      />

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-sidebar-foreground/70">
          {hasUncommittedFiles
            ? "This action commits all listed changes in one go."
            : "Make a change first, then write a commit message."}
        </p>
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => void handleCommitSubmit()}
          disabled={!canCommit}
          data-testid="agent-studio-git-commit-submit-button"
        >
          <Send className="size-3.5" />
          {isCommitting ? "Committing..." : "Commit all"}
        </Button>
      </div>

      {commitError ? (
        <p className="text-xs text-destructive" data-testid="agent-studio-git-commit-error">
          {commitError}
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
  const uncommittedFileCount = model.fileStatuses.length;
  const hasUncommittedFiles = uncommittedFileCount > 0;

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
          targetBranch={model.targetBranch}
          diffScope={model.diffScope}
          uncommittedFileCount={uncommittedFileCount}
          commitsAheadBehind={model.commitsAheadBehind}
          upstreamAheadBehind={model.upstreamAheadBehind ?? null}
          isLoading={model.isLoading}
          isCommitting={model.isCommitting ?? false}
          isPushing={model.isPushing ?? false}
          isRebasing={model.isRebasing ?? false}
          pushError={model.pushError ?? null}
          rebaseError={model.rebaseError ?? null}
          pushBranch={model.pushBranch ?? null}
          rebaseOntoTarget={model.rebaseOntoTarget ?? null}
          pullFromUpstream={model.pullFromUpstream ?? null}
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

        <CommitComposer
          hasUncommittedFiles={hasUncommittedFiles}
          uncommittedFileCount={uncommittedFileCount}
          isCommitting={model.isCommitting ?? false}
          isPushing={model.isPushing ?? false}
          isRebasing={model.isRebasing ?? false}
          commitError={model.commitError ?? null}
          commitAll={model.commitAll ?? null}
        />
      </div>
    </TooltipProvider>
  );
});
