import { ArrowDown, ArrowUp, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { memo, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PierreDiffStyle } from "@/components/features/agents/pierre-diff-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { DiffScope } from "@/pages/agents/use-agent-studio-diff-data";
import { CommitComposer } from "./commit-composer";
import { EmptyDiffState } from "./empty-diff-state";
import { FileDiffList } from "./file-diff-list";
import { GitInfoHeader } from "./git-info-header";
import { ReviewActions } from "./review-actions";
import type { AgentStudioGitPanelModel } from "./types";

const inlineCodeClassName =
  "rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground";

export const AgentStudioGitPanel = memo(function AgentStudioGitPanel({
  model,
}: {
  model: AgentStudioGitPanelModel;
}): ReactElement {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [diffStyle, setDiffStyle] = useState<PierreDiffStyle>("unified");
  const [isRebaseConflictModalOpen, setIsRebaseConflictModalOpen] = useState(false);
  const hasRebaseConflict = model.rebaseConflict != null;
  const hasInitializedConflictModalSyncRef = useRef(false);
  const previousAutoOpenNonceRef = useRef(0);
  const previousCloseNonceRef = useRef(0);
  const uncommittedFileCount = model.uncommittedFileCount;
  const hasUncommittedFiles = uncommittedFileCount > 0;
  const hasFiles = model.fileDiffs.length > 0;
  const conflictedFileCount = model.rebaseConflict?.conflictedFiles.length ?? 0;
  const conflictedFiles = useMemo(
    () =>
      new Set(
        model.fileStatuses
          .filter((status) => status.status === "unmerged")
          .map((status) => status.path),
      ),
    [model.fileStatuses],
  );
  const rebaseConflictLabel =
    model.rebaseConflict?.operation === "pull_rebase" ? "Pull with rebase" : "Rebase";
  const isHandlingRebaseConflict = model.isHandlingRebaseConflict ?? false;
  const isAbortPending = model.rebaseConflictAction === "abort";
  const isAskBuilderPending = model.rebaseConflictAction === "ask_builder";
  const rebaseConflictDescription =
    model.rebaseConflict?.operation === "pull_rebase"
      ? `The pull with rebase onto \`${model.rebaseConflict.targetBranch}\` is paused on conflicts.`
      : `The rebase onto \`${model.rebaseConflict?.targetBranch ?? "target"}\` is paused on conflicts.`;
  const rebaseConflictModalDescription =
    model.rebaseConflict?.operation === "pull_rebase"
      ? `The pull with rebase onto \`${model.rebaseConflict.targetBranch}\` stopped on conflicts. Abort the rebase or send the conflict to Builder for resolution.`
      : `The rebase onto \`${model.rebaseConflict?.targetBranch ?? "target"}\` stopped on conflicts. Abort the rebase or send the conflict to Builder for resolution.`;

  const toggleFile = useCallback(
    (filePath: string): void => {
      setExpandedFiles((previous) => {
        const next = new Set(previous);
        if (next.has(filePath)) {
          next.delete(filePath);
          model.setSelectedFile(null);
        } else {
          next.add(filePath);
          model.setSelectedFile(filePath);
        }
        return next;
      });
    },
    [model.setSelectedFile],
  );

  const handleDiffScopeChange = useCallback(
    (scope: DiffScope): void => {
      setExpandedFiles((previous) => {
        if (previous.size === 0) {
          return previous;
        }
        return new Set<string>();
      });
      model.setSelectedFile(null);
      model.setDiffScope(scope);
    },
    [model.setDiffScope, model.setSelectedFile],
  );

  const handleAskBuilderFromConflictModal = useCallback((): void => {
    setIsRebaseConflictModalOpen(false);
    void model.askBuilderToResolveRebaseConflict?.();
  }, [model.askBuilderToResolveRebaseConflict]);

  useEffect(() => {
    setExpandedFiles((previous) => {
      if (previous.size === 0) {
        return previous;
      }
      const availableFiles = new Set(model.fileDiffs.map((diff) => diff.file));
      const next = new Set<string>();
      let changed = false;

      for (const file of previous) {
        if (availableFiles.has(file)) {
          next.add(file);
          continue;
        }
        changed = true;
      }

      return changed ? next : previous;
    });

    if (
      model.selectedFile != null &&
      !model.fileDiffs.some((fileDiff) => fileDiff.file === model.selectedFile)
    ) {
      model.setSelectedFile(null);
    }
  }, [model.fileDiffs, model.selectedFile, model.setSelectedFile]);

  useEffect(() => {
    const autoOpenNonce = model.rebaseConflictAutoOpenNonce ?? 0;
    const closeNonce = model.rebaseConflictCloseNonce ?? 0;

    if (!hasInitializedConflictModalSyncRef.current) {
      hasInitializedConflictModalSyncRef.current = true;
      previousAutoOpenNonceRef.current = autoOpenNonce;
      previousCloseNonceRef.current = closeNonce;
      return;
    }

    if (closeNonce !== previousCloseNonceRef.current) {
      previousCloseNonceRef.current = closeNonce;
      setIsRebaseConflictModalOpen(false);
    }

    if (autoOpenNonce !== previousAutoOpenNonceRef.current) {
      previousAutoOpenNonceRef.current = autoOpenNonce;
      setIsRebaseConflictModalOpen(true);
    }

    if (!hasRebaseConflict) {
      setIsRebaseConflictModalOpen(false);
    }
  }, [hasRebaseConflict, model.rebaseConflictAutoOpenNonce, model.rebaseConflictCloseNonce]);

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
          isGitActionsLocked={model.isGitActionsLocked ?? false}
          gitActionsLockReason={model.gitActionsLockReason ?? null}
          showLockReasonBanner={!hasRebaseConflict && (model.showLockReasonBanner ?? true)}
          pushError={model.pushError ?? null}
          rebaseError={model.rebaseError ?? null}
          pushBranch={model.pushBranch ?? null}
          rebaseOntoTarget={model.rebaseOntoTarget ?? null}
          pullFromUpstream={model.pullFromUpstream ?? null}
          setDiffScope={handleDiffScopeChange}
          onRefresh={model.refresh}
        />

        {model.error ? (
          <div className="border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {model.error}
          </div>
        ) : null}

        {model.rebaseConflict ? (
          <div
            className="border-b border-border bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
            data-testid="agent-studio-git-rebase-strip"
          >
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{rebaseConflictLabel} in progress</p>
                  <Badge
                    variant="warning"
                    className="px-2 py-0.5 text-[10px]"
                    data-testid="agent-studio-git-rebase-conflict-count-badge"
                  >
                    {conflictedFileCount} conflicted file{conflictedFileCount === 1 ? "" : "s"}
                  </Badge>
                </div>
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  {rebaseConflictDescription}
                </p>
              </div>

              <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-0.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setIsRebaseConflictModalOpen(true)}
                  disabled={isHandlingRebaseConflict}
                  data-testid="agent-studio-git-view-conflict-details-button"
                >
                  View details
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => void model.abortRebase?.()}
                  disabled={isHandlingRebaseConflict}
                  data-testid="agent-studio-git-abort-rebase-strip-button"
                >
                  {isAbortPending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <RotateCcw className="size-4" />
                  )}
                  {isAbortPending ? "Aborting..." : "Abort rebase"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="shrink-0"
                  onClick={() => void model.askBuilderToResolveRebaseConflict?.()}
                  disabled={isHandlingRebaseConflict}
                  data-testid="agent-studio-git-ask-builder-strip-button"
                >
                  {isAskBuilderPending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  {isAskBuilderPending ? "Sending to Builder..." : "Ask Builder to resolve"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <ScrollArea className="min-h-0 flex-1">
          {hasFiles ? (
            <FileDiffList
              fileDiffs={model.fileDiffs}
              conflictedFiles={conflictedFiles}
              diffStyle={diffStyle}
              setDiffStyle={setDiffStyle}
              expandedFiles={expandedFiles}
              onToggleFile={toggleFile}
            />
          ) : (
            <EmptyDiffState isLoading={model.isLoading} />
          )}
        </ScrollArea>

        {model.onSendReview != null ? <ReviewActions onSendReview={model.onSendReview} /> : null}

        {model.diffScope === "uncommitted" ? (
          <CommitComposer
            hasUncommittedFiles={hasUncommittedFiles}
            uncommittedFileCount={uncommittedFileCount}
            isCommitting={model.isCommitting ?? false}
            isPushing={model.isPushing ?? false}
            isRebasing={model.isRebasing ?? false}
            isGitActionsLocked={model.isGitActionsLocked ?? false}
            gitActionsLockReason={model.gitActionsLockReason ?? null}
            commitError={model.commitError ?? null}
            commitAll={model.commitAll ?? null}
          />
        ) : null}

        <Dialog
          open={hasRebaseConflict && isRebaseConflictModalOpen}
          onOpenChange={setIsRebaseConflictModalOpen}
        >
          <DialogContent className="max-w-xl" data-testid="agent-studio-git-rebase-conflict-modal">
            <DialogHeader>
              <DialogTitle>{rebaseConflictLabel} conflict detected</DialogTitle>
              <DialogDescription>{rebaseConflictModalDescription}</DialogDescription>
            </DialogHeader>

            {model.rebaseConflict ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-foreground">Conflicted files</p>
                  <ul
                    className="mt-2 max-h-40 list-disc space-y-1 overflow-auto pl-5 text-sm text-muted-foreground"
                    data-testid="agent-studio-git-rebase-conflict-files"
                  >
                    {model.rebaseConflict.conflictedFiles.map((file) => (
                      <li key={file}>{file}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="text-sm font-medium text-foreground">Git output</p>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs text-foreground whitespace-pre-wrap">
                    {model.rebaseConflict.output}
                  </pre>
                </div>
              </div>
            ) : null}

            <DialogFooter className="mt-6 flex flex-row items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsRebaseConflictModalOpen(false)}
                disabled={isHandlingRebaseConflict}
                data-testid="agent-studio-git-close-rebase-conflict-modal-button"
              >
                Close
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void model.abortRebase?.()}
                  disabled={isHandlingRebaseConflict}
                  data-testid="agent-studio-git-abort-rebase-button"
                >
                  {isAbortPending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <RotateCcw className="size-4" />
                  )}
                  {isAbortPending ? "Aborting..." : "Abort rebase"}
                </Button>
                <Button
                  type="button"
                  onClick={handleAskBuilderFromConflictModal}
                  disabled={isHandlingRebaseConflict}
                  data-testid="agent-studio-git-ask-builder-button"
                >
                  {isAskBuilderPending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  {isAskBuilderPending ? "Sending to Builder..." : "Ask Builder to resolve"}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={model.pendingForcePush != null}
          onOpenChange={(open) => {
            if (!open) {
              model.cancelForcePush?.();
            }
          }}
        >
          <DialogContent
            className="max-w-xl overflow-hidden p-0"
            data-testid="agent-studio-git-force-push-modal"
          >
            <div className="space-y-6 px-6 py-6 sm:px-7 sm:py-7">
              <DialogHeader className="space-y-3 pr-10">
                <DialogTitle>Confirm force push</DialogTitle>
                <DialogDescription className="max-w-[38rem] text-[15px] leading-7">
                  The remote rejected a normal push because the upstream branch moved. Continue only
                  if you intend to rewrite the remote branch history.
                </DialogDescription>
              </DialogHeader>

              <div className="rounded-xl border border-border bg-muted/35 px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Branch
                </p>
                <div className="mt-2">
                  <code className={inlineCodeClassName}>
                    {model.pendingForcePush?.branch ?? ""}
                  </code>
                </div>
              </div>

              <div
                className="rounded-xl border border-border bg-muted/50 px-4 py-4"
                data-testid="agent-studio-git-force-push-safety-note"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Retry mode
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  The retry uses <code className={inlineCodeClassName}>--force-with-lease</code>.
                  Git checks that the remote branch still points to the commit you last fetched. If
                  someone pushed in the meantime, the retry fails instead of overwriting their work.
                  This panel never uses <code className={inlineCodeClassName}>--force</code>.
                </p>
              </div>

              {model.pendingForcePush ? (
                <div className="rounded-xl border border-border bg-muted/40 px-4 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Git output
                  </p>
                  <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-border bg-background/80 p-3 text-xs whitespace-pre-wrap text-foreground">
                    {model.pendingForcePush.output}
                  </pre>
                </div>
              ) : null}
            </div>

            <DialogFooter className="mt-0 flex flex-row items-center justify-between border-t border-border px-6 py-5 sm:px-7">
              <Button
                type="button"
                variant="outline"
                onClick={model.cancelForcePush}
                disabled={model.isPushing ?? false}
                data-testid="agent-studio-git-cancel-force-push-button"
              >
                Close
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  onClick={() => void model.confirmForcePush?.()}
                  disabled={model.isPushing ?? false}
                  data-testid="agent-studio-git-confirm-force-push-button"
                >
                  {model.isPushing ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <ArrowUp className="size-4" />
                  )}
                  {model.isPushing ? "Force pushing..." : "Force push with lease"}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={model.pendingPullRebase != null}
          onOpenChange={(open) => {
            if (model.isRebasing ?? false) {
              return;
            }
            if (!open) {
              model.cancelPullRebase?.();
            }
          }}
        >
          <DialogContent
            className="max-w-xl overflow-hidden p-0"
            data-testid="agent-studio-git-pull-rebase-modal"
          >
            <div className="space-y-6 px-6 py-6 sm:px-7 sm:py-7">
              <DialogHeader className="space-y-3 pr-10">
                <DialogTitle>Confirm pull with rebase</DialogTitle>
                <DialogDescription className="max-w-[38rem] text-[15px] leading-7">
                  Pulling{" "}
                  <code className={inlineCodeClassName}>
                    {model.pendingPullRebase?.branch ?? ""}
                  </code>{" "}
                  will run <code className={inlineCodeClassName}>git pull --rebase</code> before
                  integrating upstream changes.
                </DialogDescription>
              </DialogHeader>

              <div
                className="rounded-xl border border-border bg-muted/50 px-4 py-4"
                data-testid="agent-studio-git-pull-rebase-safety-note"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Rebase effect
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  This will replay {model.pendingPullRebase?.localAhead ?? 0} local commit
                  {(model.pendingPullRebase?.localAhead ?? 0) === 1 ? "" : "s"} on top of{" "}
                  {model.pendingPullRebase?.upstreamBehind ?? 0} upstream commit
                  {(model.pendingPullRebase?.upstreamBehind ?? 0) === 1 ? "" : "s"}.
                </p>
              </div>
            </div>

            <DialogFooter className="mt-0 flex flex-row items-center justify-between border-t border-border px-6 py-5 sm:px-7">
              <Button
                type="button"
                variant="outline"
                onClick={model.cancelPullRebase}
                disabled={model.isRebasing ?? false}
                data-testid="agent-studio-git-cancel-pull-rebase-button"
              >
                Close
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  onClick={() => void model.confirmPullRebase?.()}
                  disabled={model.isRebasing ?? false}
                  data-testid="agent-studio-git-confirm-pull-rebase-button"
                >
                  {model.isRebasing ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <ArrowDown className="size-4" />
                  )}
                  {model.isRebasing ? "Pulling..." : "Pull with rebase"}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
});
