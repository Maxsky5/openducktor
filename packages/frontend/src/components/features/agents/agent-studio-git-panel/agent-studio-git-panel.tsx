import { Undo2 } from "lucide-react";
import { memo, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { AgentStudioGitPanelModel } from "./types";

type OptimisticDiffScopeChange = {
  modelScopeAtRequest: DiffScope;
  requestedScope: DiffScope;
};

export const AgentStudioGitPanel = memo(function AgentStudioGitPanel({
  model,
}: {
  model: AgentStudioGitPanelModel;
}): ReactElement {
  const [expandedFileSelection, setExpandedFileSelection] = useState<Set<string>>(new Set());
  const [diffStyle, setDiffStyle] = useState<PierreDiffStyle>("unified");
  const [isGitConflictModalOpen, setIsGitConflictModalOpen] = useState(false);
  const [optimisticDiffScopeChange, setOptimisticDiffScopeChange] =
    useState<OptimisticDiffScopeChange | null>(null);
  const isOptimisticDiffScopeAcknowledged =
    optimisticDiffScopeChange !== null &&
    (model.diffScope === optimisticDiffScopeChange.requestedScope ||
      model.diffScope !== optimisticDiffScopeChange.modelScopeAtRequest);
  if (isOptimisticDiffScopeAcknowledged) {
    setOptimisticDiffScopeChange(null);
  }
  const activeOptimisticDiffScopeChange = isOptimisticDiffScopeAcknowledged
    ? null
    : optimisticDiffScopeChange;
  const diffScope = activeOptimisticDiffScopeChange?.requestedScope ?? model.diffScope;
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
  const displayedScopeState = model.scopeStatesByScope[diffScope];
  const displayedScopeLoaded = model.loadedScopesByScope[diffScope];
  const displayedFileDiffs = displayedScopeState.fileDiffs;
  const displayedFilePaths = useMemo(
    () => new Set(displayedFileDiffs.map((diff) => diff.file)),
    [displayedFileDiffs],
  );
  const expandedFiles = useMemo(() => {
    if (expandedFileSelection.size === 0) {
      return expandedFileSelection;
    }

    const next = new Set<string>();
    for (const file of expandedFileSelection) {
      if (displayedFilePaths.has(file)) {
        next.add(file);
      }
    }

    return next.size === expandedFileSelection.size ? expandedFileSelection : next;
  }, [displayedFilePaths, expandedFileSelection]);
  const displayedFileStatuses = displayedScopeState.fileStatuses;
  const displayedUncommittedFileCount = displayedScopeState.uncommittedFileCount;
  const displayedError = displayedScopeState.error;
  const displayedIsLoading =
    (diffScope === model.diffScope && model.isLoading) || !displayedScopeLoaded;
  const hasUncommittedFiles = displayedUncommittedFileCount > 0;
  const hasFiles = displayedFileDiffs.length > 0;
  const pendingReset = model.pendingReset ?? null;
  const canResetFiles = diffScope === "uncommitted" && model.requestFileReset != null;
  const isResetDisabled = model.isResetDisabled ?? true;
  const resetDisabledReason = model.resetDisabledReason ?? null;
  const conflictedFiles = useMemo(() => {
    const paths = new Set<string>();
    for (const status of displayedFileStatuses) {
      if (status.status === "unmerged") {
        paths.add(status.path);
      }
    }
    return paths;
  }, [displayedFileStatuses]);

  const preloadLimit = PRELOAD_DIFF_LIMIT;

  const toggleFile = useCallback((filePath: string): void => {
    setExpandedFileSelection((previous) => {
      const next = new Set(previous);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const handleDiffScopeChange = useCallback(
    (scope: DiffScope): void => {
      if (scope === diffScope) {
        return;
      }

      setOptimisticDiffScopeChange({
        modelScopeAtRequest: model.diffScope,
        requestedScope: scope,
      });
      setExpandedFileSelection((previous) => {
        if (previous.size === 0) {
          return previous;
        }
        return new Set<string>();
      });

      model.setDiffScope(scope);
    },
    [diffScope, model],
  );

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
      className="rounded-xl border border-border bg-muted/50 p-4"
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
          openInTargetPath={model.openInTargetPath ?? null}
          openInDisabledReason={model.openInDisabledReason ?? null}
          branch={displayedScopeState.branch}
          targetBranch={model.targetBranch}
          diffScope={diffScope}
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
          targetBranchOptions={model.targetBranchOptions ?? []}
          targetBranchSelectionValue={model.targetBranchSelectionValue ?? ""}
          {...(model.onUpdateTargetBranch
            ? { onUpdateTargetBranch: model.onUpdateTargetBranch }
            : {})}
          {...(model.openDirectoryInTool ? { openDirectoryInTool: model.openDirectoryInTool } : {})}
          setDiffScope={handleDiffScopeChange}
          onRefresh={() => {
            void model.refresh();
          }}
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
              diffScope={diffScope}
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
              diffScope={diffScope}
              upstreamStatus={displayedScopeState.upstreamStatus}
            />
          )}
        </ScrollArea>

        {diffScope === "uncommitted" ? (
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
            pendingReset?.kind === "hunk" ? "Resetting hunk…" : "Resetting file…"
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
