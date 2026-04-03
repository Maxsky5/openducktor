import { Undo2 } from "lucide-react";
import { memo, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { PierreDiffStyle } from "@/components/features/agents/pierre-diff-viewer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { DiffScope } from "@/features/agent-studio-git";
import {
  createGitConflictActionsModel,
  GitConflictDialog,
  GitConflictStrip,
} from "@/features/git-conflict-resolution";
import { CommitComposer } from "./commit-composer";
import { INLINE_CODE_CLASS_NAME, PRELOAD_DIFF_LIMIT } from "./constants";
import { EmptyDiffState } from "./empty-diff-state";
import { FileDiffList } from "./file-diff-list";
import { ForcePushDialog } from "./force-push-dialog";
import { GitConfirmationDialog } from "./git-confirmation-dialog";
import { GitInfoHeader } from "./git-info-header";
import { PullRebaseDialog } from "./pull-rebase-dialog";
import { ReviewActions } from "./review-actions";
import type { AgentStudioGitPanelModel } from "./types";

export const AgentStudioGitPanel = memo(function AgentStudioGitPanel({
  model,
}: {
  model: AgentStudioGitPanelModel;
}): ReactElement {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [diffStyle, setDiffStyle] = useState<PierreDiffStyle>("unified");
  const [uiDiffScope, setUiDiffScope] = useState<DiffScope>(model.diffScope);
  const [isGitConflictModalOpen, setIsGitConflictModalOpen] = useState(false);
  const activeGitConflict = model.gitConflict ?? null;
  const hasGitConflict = activeGitConflict != null;
  const isHandlingGitConflict = model.isHandlingGitConflict ?? false;
  const gitConflictAction = model.gitConflictAction;
  const gitConflictAutoOpenNonce = model.gitConflictAutoOpenNonce ?? 0;
  const gitConflictCloseNonce = model.gitConflictCloseNonce ?? 0;
  const abortGitConflict = model.abortGitConflict;
  const askBuilderToResolveGitConflict = model.askBuilderToResolveGitConflict;
  const hasInitializedConflictModalSyncRef = useRef(false);
  const previousAutoOpenNonceRef = useRef(0);
  const previousCloseNonceRef = useRef(0);
  const pendingScopeUpdateTimeoutRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(
    null,
  );
  const displayedScopeState = model.scopeStatesByScope[uiDiffScope];
  const displayedScopeLoaded = model.loadedScopesByScope[uiDiffScope];
  const displayedFileDiffs = displayedScopeState.fileDiffs;
  const displayedFilePaths = useMemo(
    () => new Set(displayedFileDiffs.map((diff) => diff.file)),
    [displayedFileDiffs],
  );
  const displayedFileStatuses = displayedScopeState.fileStatuses;
  const displayedUncommittedFileCount = displayedScopeState.uncommittedFileCount;
  const displayedError = displayedScopeState.error ?? model.error;
  const displayedIsLoading = model.isLoading || !displayedScopeLoaded;
  const hasUncommittedFiles = displayedUncommittedFileCount > 0;
  const hasFiles = displayedFileDiffs.length > 0;
  const pendingReset = model.pendingReset ?? null;
  const canResetFiles = uiDiffScope === "uncommitted" && model.requestFileReset != null;
  const isResetDisabled = model.isResetDisabled ?? true;
  const resetDisabledReason = model.resetDisabledReason ?? null;
  const conflictedFiles = useMemo(
    () =>
      new Set(
        displayedFileStatuses
          .filter((status) => status.status === "unmerged")
          .map((status) => status.path),
      ),
    [displayedFileStatuses],
  );

  const preloadLimit = PRELOAD_DIFF_LIMIT;

  const toggleFile = useCallback((filePath: string): void => {
    flushSync(() => {
      setExpandedFiles((previous) => {
        const next = new Set(previous);
        if (next.has(filePath)) {
          next.delete(filePath);
        } else {
          next.add(filePath);
        }
        return next;
      });
    });
  }, []);

  const handleDiffScopeChange = useCallback(
    (scope: DiffScope): void => {
      if (scope === uiDiffScope) {
        return;
      }

      flushSync(() => {
        setUiDiffScope(scope);
        setExpandedFiles((previous) => {
          if (previous.size === 0) {
            return previous;
          }
          return new Set<string>();
        });
      });

      if (pendingScopeUpdateTimeoutRef.current !== null) {
        globalThis.clearTimeout(pendingScopeUpdateTimeoutRef.current);
        pendingScopeUpdateTimeoutRef.current = null;
      }

      if (process.env.NODE_ENV === "test") {
        model.setDiffScope(scope);
        return;
      }

      pendingScopeUpdateTimeoutRef.current = globalThis.setTimeout(() => {
        pendingScopeUpdateTimeoutRef.current = null;
        model.setDiffScope(scope);
      }, 0);
    },
    [model, uiDiffScope],
  );

  useEffect(() => {
    setUiDiffScope((current) => (current === model.diffScope ? current : model.diffScope));
  }, [model.diffScope]);

  useEffect(() => {
    return () => {
      if (pendingScopeUpdateTimeoutRef.current !== null) {
        globalThis.clearTimeout(pendingScopeUpdateTimeoutRef.current);
      }
    };
  }, []);

  const handleAskBuilderFromConflictModal = useCallback((): void => {
    setIsGitConflictModalOpen(false);
    void askBuilderToResolveGitConflict?.();
  }, [askBuilderToResolveGitConflict]);

  const stripGitConflictActions = useMemo(() => {
    if (!activeGitConflict) {
      return null;
    }
    return createGitConflictActionsModel({
      operation: activeGitConflict.operation,
      isHandlingConflict: isHandlingGitConflict,
      conflictAction: gitConflictAction,
      onAbort: () => {
        void abortGitConflict?.();
      },
      onAskBuilder: () => {
        void askBuilderToResolveGitConflict?.();
      },
    });
  }, [
    abortGitConflict,
    activeGitConflict,
    askBuilderToResolveGitConflict,
    gitConflictAction,
    isHandlingGitConflict,
  ]);

  const modalGitConflictActions = useMemo(() => {
    if (!activeGitConflict) {
      return null;
    }
    return createGitConflictActionsModel({
      operation: activeGitConflict.operation,
      isHandlingConflict: isHandlingGitConflict,
      conflictAction: gitConflictAction,
      onAbort: () => {
        void abortGitConflict?.();
      },
      onAskBuilder: handleAskBuilderFromConflictModal,
    });
  }, [
    abortGitConflict,
    activeGitConflict,
    gitConflictAction,
    handleAskBuilderFromConflictModal,
    isHandlingGitConflict,
  ]);

  useEffect(() => {
    setExpandedFiles((previous) => {
      if (previous.size === 0) {
        return previous;
      }
      const next = new Set<string>();
      let changed = false;

      for (const file of previous) {
        if (displayedFilePaths.has(file)) {
          next.add(file);
          continue;
        }
        changed = true;
      }

      return changed ? next : previous;
    });
  }, [displayedFilePaths]);

  useEffect(() => {
    if (!hasInitializedConflictModalSyncRef.current) {
      hasInitializedConflictModalSyncRef.current = true;
      previousAutoOpenNonceRef.current = gitConflictAutoOpenNonce;
      previousCloseNonceRef.current = gitConflictCloseNonce;
      return;
    }

    let nextModalOpenState: boolean | null = null;

    if (gitConflictCloseNonce !== previousCloseNonceRef.current) {
      previousCloseNonceRef.current = gitConflictCloseNonce;
      nextModalOpenState = false;
    }

    if (gitConflictAutoOpenNonce !== previousAutoOpenNonceRef.current) {
      previousAutoOpenNonceRef.current = gitConflictAutoOpenNonce;
      nextModalOpenState = true;
    }

    if (!hasGitConflict) {
      nextModalOpenState = false;
    }

    if (nextModalOpenState !== null) {
      setIsGitConflictModalOpen(nextModalOpenState);
    }
  }, [gitConflictAutoOpenNonce, gitConflictCloseNonce, hasGitConflict]);

  const resetDialogTitle =
    pendingReset?.kind === "hunk" ? "Confirm hunk reset" : "Confirm file reset";
  const resetDialogDescription =
    pendingReset?.kind === "hunk" ? (
      <>
        This discards the selected uncommitted diff hunk in{" "}
        <code className={INLINE_CODE_CLASS_NAME}>{pendingReset.filePath}</code> and restores it to
        <code className={INLINE_CODE_CLASS_NAME}> HEAD</code>.
      </>
    ) : (
      <>
        This discards all local uncommitted changes in{" "}
        <code className={INLINE_CODE_CLASS_NAME}>{pendingReset?.filePath ?? ""}</code> and restores
        the file to <code className={INLINE_CODE_CLASS_NAME}>HEAD</code>.
      </>
    );
  const resetDialogBody = pendingReset ? (
    <div
      className="rounded-xl border border-border bg-muted/50 px-4 py-4"
      data-testid="agent-studio-git-reset-safety-note"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Reset target
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm leading-6 text-muted-foreground">
        <code className={INLINE_CODE_CLASS_NAME}>{pendingReset.filePath}</code>
        {pendingReset.kind === "hunk" ? (
          <span>Hunk {pendingReset.hunkIndex + 1}</span>
        ) : (
          <span>Entire file</span>
        )}
      </div>
    </div>
  ) : null;

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <GitInfoHeader
          contextMode={model.contextMode ?? "worktree"}
          pullRequest={model.pullRequest ?? null}
          branch={displayedScopeState.branch}
          targetBranch={model.targetBranch}
          diffScope={uiDiffScope}
          uncommittedFileCount={displayedUncommittedFileCount}
          commitsAheadBehind={displayedScopeState.commitsAheadBehind}
          upstreamAheadBehind={displayedScopeState.upstreamAheadBehind ?? null}
          upstreamStatus={displayedScopeState.upstreamStatus}
          isLoading={displayedIsLoading}
          isCommitting={model.isCommitting ?? false}
          isPushing={model.isPushing ?? false}
          isRebasing={model.isRebasing ?? false}
          isDetectingPullRequest={model.isDetectingPullRequest ?? false}
          isGitActionsLocked={model.isGitActionsLocked ?? false}
          gitActionsLockReason={model.gitActionsLockReason ?? null}
          showLockReasonBanner={!hasGitConflict && (model.showLockReasonBanner ?? true)}
          pushError={model.pushError ?? null}
          rebaseError={model.rebaseError ?? null}
          pushBranch={model.pushBranch ?? null}
          rebaseOntoTarget={model.rebaseOntoTarget ?? null}
          pullFromUpstream={model.pullFromUpstream ?? null}
          onDetectPullRequest={model.onDetectPullRequest ?? null}
          setDiffScope={handleDiffScopeChange}
          onRefresh={model.refresh}
        />

        {displayedError ? (
          <div className="border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {displayedError}
          </div>
        ) : null}

        {activeGitConflict && stripGitConflictActions ? (
          <GitConflictStrip
            conflict={activeGitConflict}
            actions={stripGitConflictActions}
            onViewDetails={() => setIsGitConflictModalOpen(true)}
          />
        ) : null}

        <ScrollArea className="min-h-0 flex-1">
          {hasFiles ? (
            <FileDiffList
              fileDiffs={displayedFileDiffs}
              conflictedFiles={conflictedFiles}
              diffStyle={diffStyle}
              setDiffStyle={setDiffStyle}
              expandedFiles={expandedFiles}
              onToggleFile={toggleFile}
              preloadLimit={preloadLimit}
              canResetFiles={canResetFiles}
              isResetDisabled={isResetDisabled}
              resetDisabledReason={resetDisabledReason}
              onRequestFileReset={model.requestFileReset}
              onRequestHunkReset={model.requestHunkReset}
            />
          ) : (
            <EmptyDiffState
              isLoading={displayedIsLoading}
              contextMode={model.contextMode ?? "worktree"}
              diffScope={uiDiffScope}
              upstreamStatus={displayedScopeState.upstreamStatus}
            />
          )}
        </ScrollArea>

        {model.onSendReview != null ? <ReviewActions onSendReview={model.onSendReview} /> : null}

        {uiDiffScope === "uncommitted" ? (
          <CommitComposer
            hasUncommittedFiles={hasUncommittedFiles}
            uncommittedFileCount={displayedUncommittedFileCount}
            isCommitting={model.isCommitting ?? false}
            isPushing={model.isPushing ?? false}
            isRebasing={model.isRebasing ?? false}
            isGitActionsLocked={model.isGitActionsLocked ?? false}
            gitActionsLockReason={model.gitActionsLockReason ?? null}
            commitError={model.commitError ?? null}
            commitAll={model.commitAll ?? null}
          />
        ) : null}

        {modalGitConflictActions ? (
          <GitConflictDialog
            conflict={activeGitConflict}
            open={hasGitConflict && isGitConflictModalOpen}
            onOpenChange={setIsGitConflictModalOpen}
            actions={modalGitConflictActions}
          />
        ) : null}

        <ForcePushDialog
          pendingForcePush={model.pendingForcePush ?? null}
          isPushing={model.isPushing ?? false}
          onCancel={() => model.cancelForcePush?.()}
          onConfirm={() => void model.confirmForcePush?.()}
        />

        <PullRebaseDialog
          pendingPullRebase={model.pendingPullRebase ?? null}
          isRebasing={model.isRebasing ?? false}
          onCancel={() => model.cancelPullRebase?.()}
          onConfirm={() => void model.confirmPullRebase?.()}
        />

        <GitConfirmationDialog
          open={pendingReset != null}
          onOpenChange={(open) => {
            if (model.isResetting) {
              return;
            }
            if (!open) {
              model.cancelReset?.();
            }
          }}
          title={resetDialogTitle}
          description={resetDialogDescription}
          closeLabel="Keep changes"
          closeDisabled={model.isResetting ?? false}
          onClose={() => model.cancelReset?.()}
          closeTestId="agent-studio-git-cancel-reset-button"
          confirmLabel={pendingReset?.kind === "hunk" ? "Reset hunk" : "Reset file"}
          confirmPendingLabel={
            pendingReset?.kind === "hunk" ? "Resetting hunk..." : "Resetting file..."
          }
          confirmPending={model.isResetting ?? false}
          confirmDisabled={model.isResetting ?? false}
          onConfirm={() => void model.confirmReset?.()}
          confirmTestId="agent-studio-git-confirm-reset-button"
          confirmIcon={Undo2}
          contentTestId="agent-studio-git-reset-modal"
        >
          {resetDialogBody}
        </GitConfirmationDialog>
      </div>
    </TooltipProvider>
  );
});
