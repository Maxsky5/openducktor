import { memo, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PierreDiffStyle } from "@/components/features/agents/pierre-diff-viewer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { DiffScope } from "@/pages/agents/use-agent-studio-diff-data";
import { CommitComposer } from "./commit-composer";
import { EmptyDiffState } from "./empty-diff-state";
import { FileDiffList } from "./file-diff-list";
import { ForcePushDialog } from "./force-push-dialog";
import { GitInfoHeader } from "./git-info-header";
import { PullRebaseDialog } from "./pull-rebase-dialog";
import { createRebaseConflictActionsModel } from "./rebase-conflict-actions";
import { RebaseConflictDialog } from "./rebase-conflict-dialog";
import { RebaseConflictStrip } from "./rebase-conflict-strip";
import { ReviewActions } from "./review-actions";
import type { AgentStudioGitPanelModel } from "./types";

export const AgentStudioGitPanel = memo(function AgentStudioGitPanel({
  model,
}: {
  model: AgentStudioGitPanelModel;
}): ReactElement {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [diffStyle, setDiffStyle] = useState<PierreDiffStyle>("unified");
  const [isRebaseConflictModalOpen, setIsRebaseConflictModalOpen] = useState(false);
  const [selectedFileNotificationTick, setSelectedFileNotificationTick] = useState(0);
  const hasRebaseConflict = model.rebaseConflict != null;
  const hasInitializedConflictModalSyncRef = useRef(false);
  const previousAutoOpenNonceRef = useRef(0);
  const previousCloseNonceRef = useRef(0);
  const pendingSelectedFilesRef = useRef<Array<string | null>>([]);
  const uncommittedFileCount = model.uncommittedFileCount;
  const hasUncommittedFiles = uncommittedFileCount > 0;
  const hasFiles = model.fileDiffs.length > 0;
  const conflictedFiles = useMemo(
    () =>
      new Set(
        model.fileStatuses
          .filter((status) => status.status === "unmerged")
          .map((status) => status.path),
      ),
    [model.fileStatuses],
  );

  const toggleFile = useCallback((filePath: string): void => {
    setExpandedFiles((previous) => {
      const next = new Set(previous);
      if (next.has(filePath)) {
        next.delete(filePath);
        pendingSelectedFilesRef.current.push(null);
      } else {
        next.add(filePath);
        pendingSelectedFilesRef.current.push(filePath);
      }
      return next;
    });
    setSelectedFileNotificationTick((current) => current + 1);
  }, []);

  useEffect(() => {
    if (selectedFileNotificationTick === 0 || pendingSelectedFilesRef.current.length === 0) {
      return;
    }

    const nextSelectedFiles = pendingSelectedFilesRef.current;
    pendingSelectedFilesRef.current = [];

    for (const nextSelectedFile of nextSelectedFiles) {
      model.setSelectedFile(nextSelectedFile);
    }
  }, [model.setSelectedFile, selectedFileNotificationTick]);

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

  const stripRebaseConflictActions = useMemo(
    () =>
      createRebaseConflictActionsModel({
        isHandlingRebaseConflict: model.isHandlingRebaseConflict ?? false,
        rebaseConflictAction: model.rebaseConflictAction,
        onAbort: () => {
          void model.abortRebase?.();
        },
        onAskBuilder: () => {
          void model.askBuilderToResolveRebaseConflict?.();
        },
      }),
    [
      model.abortRebase,
      model.askBuilderToResolveRebaseConflict,
      model.isHandlingRebaseConflict,
      model.rebaseConflictAction,
    ],
  );

  const modalRebaseConflictActions = useMemo(
    () =>
      createRebaseConflictActionsModel({
        isHandlingRebaseConflict: model.isHandlingRebaseConflict ?? false,
        rebaseConflictAction: model.rebaseConflictAction,
        onAbort: () => {
          void model.abortRebase?.();
        },
        onAskBuilder: handleAskBuilderFromConflictModal,
      }),
    [
      handleAskBuilderFromConflictModal,
      model.abortRebase,
      model.isHandlingRebaseConflict,
      model.rebaseConflictAction,
    ],
  );

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

    let nextModalOpenState: boolean | null = null;

    if (closeNonce !== previousCloseNonceRef.current) {
      previousCloseNonceRef.current = closeNonce;
      nextModalOpenState = false;
    }

    if (autoOpenNonce !== previousAutoOpenNonceRef.current) {
      previousAutoOpenNonceRef.current = autoOpenNonce;
      nextModalOpenState = true;
    }

    if (!hasRebaseConflict) {
      nextModalOpenState = false;
    }

    if (nextModalOpenState !== null) {
      setIsRebaseConflictModalOpen(nextModalOpenState);
    }
  }, [hasRebaseConflict, model.rebaseConflictAutoOpenNonce, model.rebaseConflictCloseNonce]);

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <GitInfoHeader
          contextMode={model.contextMode ?? "worktree"}
          pullRequest={model.pullRequest ?? null}
          branch={model.branch}
          targetBranch={model.targetBranch}
          diffScope={model.diffScope}
          uncommittedFileCount={uncommittedFileCount}
          commitsAheadBehind={model.commitsAheadBehind}
          upstreamAheadBehind={model.upstreamAheadBehind ?? null}
          upstreamStatus={model.upstreamStatus}
          isLoading={model.isLoading}
          isCommitting={model.isCommitting ?? false}
          isPushing={model.isPushing ?? false}
          isRebasing={model.isRebasing ?? false}
          isDetectingPullRequest={model.isDetectingPullRequest ?? false}
          isGitActionsLocked={model.isGitActionsLocked ?? false}
          gitActionsLockReason={model.gitActionsLockReason ?? null}
          showLockReasonBanner={!hasRebaseConflict && (model.showLockReasonBanner ?? true)}
          pushError={model.pushError ?? null}
          rebaseError={model.rebaseError ?? null}
          pushBranch={model.pushBranch ?? null}
          rebaseOntoTarget={model.rebaseOntoTarget ?? null}
          pullFromUpstream={model.pullFromUpstream ?? null}
          onDetectPullRequest={model.onDetectPullRequest ?? null}
          setDiffScope={handleDiffScopeChange}
          onRefresh={model.refresh}
        />

        {model.error ? (
          <div className="border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {model.error}
          </div>
        ) : null}

        {model.rebaseConflict ? (
          <RebaseConflictStrip
            conflict={model.rebaseConflict}
            actions={stripRebaseConflictActions}
            onViewDetails={() => setIsRebaseConflictModalOpen(true)}
          />
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
            <EmptyDiffState
              isLoading={model.isLoading}
              contextMode={model.contextMode ?? "worktree"}
              diffScope={model.diffScope}
              upstreamStatus={model.upstreamStatus}
            />
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

        <RebaseConflictDialog
          conflict={model.rebaseConflict ?? null}
          open={hasRebaseConflict && isRebaseConflictModalOpen}
          onOpenChange={setIsRebaseConflictModalOpen}
          actions={modalRebaseConflictActions}
        />

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
      </div>
    </TooltipProvider>
  );
});
