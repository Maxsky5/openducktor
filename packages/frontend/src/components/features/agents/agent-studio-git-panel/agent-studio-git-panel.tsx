import { Undo2 } from "lucide-react";
import {
  type ComponentProps,
  type Dispatch,
  memo,
  type ReactElement,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  const expandedSelection = useExpandedFileSelection();
  const { diffScope, handleDiffScopeChange } = useOptimisticDiffScope(
    model,
    expandedSelection.clear,
  );
  const [diffStyle, setDiffStyle] = useState<PierreDiffStyle>("unified");
  const conflict = useGitConflictPanel(model);
  const displayedScopeState = model.scopeStatesByScope[diffScope];
  const displayedScopeLoaded = model.loadedScopesByScope[diffScope];
  const displayedFileDiffs = displayedScopeState.fileDiffs;
  const expandedFiles = useMemo(
    () => pruneExpandedFiles(expandedSelection.files, displayedFileDiffs),
    [displayedFileDiffs, expandedSelection.files],
  );
  const displayedFileStatuses = displayedScopeState.fileStatuses;
  const displayedUncommittedFileCount = displayedScopeState.uncommittedFileCount;
  const displayedError = displayedScopeState.error;
  const displayedIsInitialLoading = !displayedScopeLoaded;
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

  const resetDialog = getResetDialog(pendingReset);

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <AgentStudioGitPanelContent
          model={model}
          view={{
            conflict,
            diffScope,
            displayedScopeState,
            displayedError,
            displayedFileDiffs,
            displayedUncommittedFileCount,
            displayedIsInitialLoading,
            expandedFiles,
            onToggleFile: expandedSelection.toggle,
            handleDiffScopeChange,
            conflictedFiles,
            diffStyle,
            setDiffStyle,
            preloadLimit,
            canResetFiles,
            isResetDisabled,
            resetDisabledReason,
            hasFiles,
            hasUncommittedFiles,
          }}
        />
        <AgentStudioGitPanelDialogs
          model={model}
          conflict={conflict}
          pendingReset={pendingReset}
          resetDialog={resetDialog}
        />
      </div>
    </TooltipProvider>
  );
});

type GitPanelScopeState = AgentStudioGitPanelModel["scopeStatesByScope"][DiffScope];
type GitPanelConflict = ReturnType<typeof useGitConflictPanel>;
type GitPanelView = {
  conflict: GitPanelConflict;
  diffScope: DiffScope;
  displayedScopeState: GitPanelScopeState;
  displayedError: string | null;
  displayedFileDiffs: GitPanelScopeState["fileDiffs"];
  displayedUncommittedFileCount: number;
  displayedIsInitialLoading: boolean;
  expandedFiles: Set<string>;
  onToggleFile: (filePath: string) => void;
  handleDiffScopeChange: (scope: DiffScope) => void;
  conflictedFiles: Set<string>;
  diffStyle: PierreDiffStyle;
  setDiffStyle: Dispatch<SetStateAction<PierreDiffStyle>>;
  preloadLimit: number;
  canResetFiles: boolean;
  isResetDisabled: boolean;
  resetDisabledReason: string | null;
  hasFiles: boolean;
  hasUncommittedFiles: boolean;
};

function AgentStudioGitPanelContent({
  model,
  view,
}: {
  model: AgentStudioGitPanelModel;
  view: GitPanelView;
}): ReactElement {
  return (
    <>
      <AgentStudioGitPanelHeader model={model} view={view} />
      <AgentStudioGitDiff model={model} view={view} />
      <AgentStudioGitCommit model={model} view={view} />
    </>
  );
}

function AgentStudioGitPanelHeader({
  model,
  view,
}: {
  model: AgentStudioGitPanelModel;
  view: GitPanelView;
}): ReactElement {
  const headerProps = getGitInfoHeaderProps(model, view);
  return (
    <>
      <GitInfoHeader {...headerProps} />
      {view.displayedError ? (
        <div className="border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {view.displayedError}
        </div>
      ) : null}
      {view.conflict.active && view.conflict.stripActions ? (
        <GitConflictStrip
          conflict={view.conflict.active}
          actions={view.conflict.stripActions}
          onViewDetails={() => view.conflict.setModalOpen(true)}
        />
      ) : null}
    </>
  );
}

function getGitInfoHeaderProps(
  model: AgentStudioGitPanelModel,
  view: GitPanelView,
): ComponentProps<typeof GitInfoHeader> {
  const props: ComponentProps<typeof GitInfoHeader> = {
    contextMode: model.contextMode ?? "worktree",
    pullRequest: model.pullRequest ?? null,
    branch: view.displayedScopeState.branch,
    targetBranch: model.targetBranch,
    diffScope: view.diffScope,
    uncommittedFileCount: view.displayedUncommittedFileCount,
    commitsAheadBehind: view.displayedScopeState.commitsAheadBehind,
    upstreamAheadBehind: view.displayedScopeState.upstreamAheadBehind ?? null,
    upstreamStatus: view.displayedScopeState.upstreamStatus,
    isLoading: model.isLoading,
    isCommitting: model.isCommitting ?? false,
    isPushing: model.isPushing ?? false,
    isRebasing: model.isRebasing ?? false,
    isDetectingPullRequest: model.isDetectingPullRequest ?? false,
    detectPullRequestDisabledReason: model.detectPullRequestDisabledReason ?? null,
    isGitActionsLocked: model.isGitActionsLocked ?? false,
    gitActionsLockReason: model.gitActionsLockReason ?? null,
    showLockReasonBanner: !view.conflict.hasConflict && (model.showLockReasonBanner ?? true),
    pushError: model.pushError ?? null,
    rebaseError: model.rebaseError ?? null,
    pushBranch: model.pushBranch ?? null,
    rebaseOntoTarget: model.rebaseOntoTarget ?? null,
    pullFromUpstream: model.pullFromUpstream ?? null,
    onDetectPullRequest: model.onDetectPullRequest ?? null,
    targetBranchOptions: model.targetBranchOptions ?? [],
    targetBranchSelectionValue: model.targetBranchSelectionValue ?? "",
    setDiffScope: view.handleDiffScopeChange,
    onRefresh: () => void model.refresh(),
  };
  if (model.onUpdateTargetBranch) {
    props.onUpdateTargetBranch = model.onUpdateTargetBranch;
  }
  return props;
}

function AgentStudioGitDiff({
  model,
  view,
}: {
  model: AgentStudioGitPanelModel;
  view: GitPanelView;
}): ReactElement {
  return (
    <ScrollArea className="min-h-0 flex-1">
      {view.hasFiles ? (
        <FileDiffList
          fileDiffs={view.displayedFileDiffs}
          diffScope={view.diffScope}
          conflictedFiles={view.conflictedFiles}
          diffStyle={view.diffStyle}
          setDiffStyle={view.setDiffStyle}
          expandedFiles={view.expandedFiles}
          onToggleFile={view.onToggleFile}
          preloadLimit={view.preloadLimit}
          canResetFiles={view.canResetFiles}
          isResetDisabled={view.isResetDisabled}
          resetDisabledReason={view.resetDisabledReason}
          onRequestFileReset={model.requestFileReset}
          onRequestHunkReset={model.requestHunkReset}
        />
      ) : (
        <EmptyDiffState
          isLoading={view.displayedIsInitialLoading}
          contextMode={model.contextMode ?? "worktree"}
          diffScope={view.diffScope}
          upstreamStatus={view.displayedScopeState.upstreamStatus}
        />
      )}
    </ScrollArea>
  );
}

function AgentStudioGitCommit({
  model,
  view,
}: {
  model: AgentStudioGitPanelModel;
  view: GitPanelView;
}): ReactElement | null {
  if (view.diffScope !== "uncommitted") {
    return null;
  }
  return (
    <CommitComposer
      hasUncommittedFiles={view.hasUncommittedFiles}
      uncommittedFileCount={view.displayedUncommittedFileCount}
      isCommitting={model.isCommitting ?? false}
      isPushing={model.isPushing ?? false}
      isRebasing={model.isRebasing ?? false}
      isGitActionsLocked={model.isGitActionsLocked ?? false}
      gitActionsLockReason={model.gitActionsLockReason ?? null}
      commitError={model.commitError ?? null}
      commitAll={model.commitAll ?? null}
    />
  );
}

type PendingReset = NonNullable<AgentStudioGitPanelModel["pendingReset"]>;

function AgentStudioGitPanelDialogs({
  model,
  conflict,
  pendingReset,
  resetDialog,
}: {
  model: AgentStudioGitPanelModel;
  conflict: GitPanelConflict;
  pendingReset: PendingReset | null;
  resetDialog: ReturnType<typeof getResetDialog>;
}): ReactElement {
  return (
    <>
      {conflict.modalActions ? (
        <GitConflictDialog
          conflict={conflict.active}
          open={conflict.hasConflict && conflict.isModalOpen}
          onOpenChange={conflict.setModalOpen}
          actions={conflict.modalActions}
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
        title={resetDialog.title}
        description={resetDialog.description}
        closeLabel="Keep changes"
        closeDisabled={model.isResetting ?? false}
        onClose={() => model.cancelReset?.()}
        closeTestId="agent-studio-git-cancel-reset-button"
        confirmLabel={pendingReset?.kind === "hunk" ? "Reset hunk" : "Reset file"}
        confirmPendingLabel={pendingReset?.kind === "hunk" ? "Resetting hunk…" : "Resetting file…"}
        confirmPending={model.isResetting ?? false}
        confirmDisabled={model.isResetting ?? false}
        onConfirm={() => void model.confirmReset?.()}
        confirmTestId="agent-studio-git-confirm-reset-button"
        confirmIcon={Undo2}
        contentTestId="agent-studio-git-reset-modal"
      >
        {resetDialog.body}
      </GitConfirmationDialog>
    </>
  );
}

function getResetDialog(pendingReset: PendingReset | null) {
  const isHunk = pendingReset?.kind === "hunk";
  const title = isHunk ? "Confirm hunk reset" : "Confirm file reset";
  const description = isHunk ? (
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
  const body = pendingReset ? (
    <div
      className="rounded-xl border border-border bg-muted/50 p-4"
      data-testid="agent-studio-git-reset-safety-note"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Reset target
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm leading-6 text-muted-foreground">
        <code className={INLINE_CODE_CLASS_NAME}>{pendingReset.filePath}</code>
        {isHunk ? <span>Hunk {pendingReset.hunkIndex + 1}</span> : <span>Entire file</span>}
      </div>
    </div>
  ) : null;
  return { body, description, title };
}

function pruneExpandedFiles(
  files: Set<string>,
  diffs: GitPanelScopeState["fileDiffs"],
): Set<string> {
  if (files.size === 0) {
    return files;
  }
  const displayedPaths = new Set(diffs.map((diff) => diff.file));
  const shownFiles = new Set([...files].filter((file) => displayedPaths.has(file)));
  return shownFiles.size === files.size ? files : shownFiles;
}

function useExpandedFileSelection() {
  const [files, setFiles] = useState<Set<string>>(new Set());
  const clear = useCallback(() => {
    setFiles((current) => (current.size === 0 ? current : new Set<string>()));
  }, []);
  const toggle = useCallback((filePath: string): void => {
    setFiles((current) => {
      const next = new Set(current);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);
  return { clear, files, toggle };
}

function useOptimisticDiffScope(model: AgentStudioGitPanelModel, clearFiles: () => void) {
  const [change, setChange] = useState<OptimisticDiffScopeChange | null>(null);
  const acknowledged =
    change !== null &&
    (model.diffScope === change.requestedScope || model.diffScope !== change.modelScopeAtRequest);
  if (acknowledged) {
    setChange(null);
  }
  let diffScope = model.diffScope;
  if (!acknowledged && change) {
    diffScope = change.requestedScope;
  }
  const handleDiffScopeChange = useCallback(
    (scope: DiffScope): void => {
      if (scope === diffScope) {
        return;
      }
      setChange({ modelScopeAtRequest: model.diffScope, requestedScope: scope });
      clearFiles();
      model.setDiffScope(scope);
    },
    [clearFiles, diffScope, model],
  );
  return { diffScope, handleDiffScopeChange };
}

function useGitConflictPanel(model: AgentStudioGitPanelModel) {
  const {
    abortGitConflict,
    askBuilderToResolveGitConflict,
    gitConflict,
    gitConflictAction,
    gitConflictAutoOpenNonce,
    gitConflictCloseNonce,
    isHandlingGitConflict,
  } = model;
  const active = gitConflict ?? null;
  const hasConflict = active != null;
  const [isModalOpen, setModalOpen] = useState(false);
  const initializedRef = useRef(false);
  const previousAutoOpenNonceRef = useRef(0);
  const previousCloseNonceRef = useRef(0);
  const autoOpenNonce = gitConflictAutoOpenNonce ?? 0;
  const closeNonce = gitConflictCloseNonce ?? 0;
  const closeAndAskBuilder = useCallback((): void => {
    setModalOpen(false);
    void askBuilderToResolveGitConflict?.();
  }, [askBuilderToResolveGitConflict]);
  const stripActions = useMemo(
    () =>
      active
        ? createGitConflictActionsModel({
            operation: active.operation,
            isHandlingConflict: isHandlingGitConflict ?? false,
            conflictAction: gitConflictAction,
            onAbort: () => void abortGitConflict?.(),
            onAskBuilder: () => void askBuilderToResolveGitConflict?.(),
          })
        : null,
    [
      active,
      abortGitConflict,
      askBuilderToResolveGitConflict,
      gitConflictAction,
      isHandlingGitConflict,
    ],
  );
  const modalActions = useMemo(
    () =>
      active
        ? createGitConflictActionsModel({
            operation: active.operation,
            isHandlingConflict: isHandlingGitConflict ?? false,
            conflictAction: gitConflictAction,
            onAbort: () => void abortGitConflict?.(),
            onAskBuilder: closeAndAskBuilder,
          })
        : null,
    [active, closeAndAskBuilder, abortGitConflict, gitConflictAction, isHandlingGitConflict],
  );

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      previousAutoOpenNonceRef.current = autoOpenNonce;
      previousCloseNonceRef.current = closeNonce;
      return;
    }
    let nextOpen: boolean | null = null;
    if (closeNonce !== previousCloseNonceRef.current) {
      previousCloseNonceRef.current = closeNonce;
      nextOpen = false;
    }
    if (autoOpenNonce !== previousAutoOpenNonceRef.current) {
      previousAutoOpenNonceRef.current = autoOpenNonce;
      nextOpen = true;
    }
    if (!hasConflict) {
      nextOpen = false;
    }
    if (nextOpen !== null) {
      setModalOpen(nextOpen);
    }
  }, [autoOpenNonce, closeNonce, hasConflict]);

  return { active, hasConflict, isModalOpen, modalActions, setModalOpen, stripActions };
}
