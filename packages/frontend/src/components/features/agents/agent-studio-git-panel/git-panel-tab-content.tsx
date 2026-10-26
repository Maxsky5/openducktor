import type { GitLocalChanges } from "@openducktor/contracts";
import { type ReactElement, useCallback, useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { collectUnmergedFilePaths } from "@openducktor/frontend-core/git/model/unmerged-file-paths";
import { toInlineCommentDraftOwnerKey } from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import { PRELOAD_DIFF_LIMIT } from "./constants";
import { DiffLoadFailedState, EmptyDiffState } from "./empty-diff-state";
import { FileDiffListWithHeader } from "./file-diff-list";
import { type FileListViewMode, useFileListViewModeStore } from "./file-list-view-preference";
import { listFileKey } from "./git-file-row-actions";
import { GitHistoryView } from "./git-history-view";
import { GitLocalChangesView } from "./git-local-changes-view";
import type { AgentStudioGitPanelModel, GitPanelView } from "./types";
import type { FileListState } from "./use-file-list-state";

export function AgentStudioGitTabContent({
  model,
  view,
}: {
  model: AgentStudioGitPanelModel;
  view: GitPanelView;
}): ReactElement {
  const commentOwnerKey = useMemo(
    () => (model.commentOwner ? toInlineCommentDraftOwnerKey(model.commentOwner) : null),
    [model.commentOwner],
  );
  const viewMode = useFileListViewModeStore((store) => store.viewMode);
  const setViewMode = useFileListViewModeStore((store) => store.setViewMode);

  if (view.activeTab === "history") {
    return (
      <GitHistoryView
        contextKey={JSON.stringify([view.contextKey, model.targetBranchSelectionValue ?? null])}
        pending={model.comparisonPending ?? false}
        repoPath={model.repoPath ?? null}
        workingDir={model.repoPath ? (model.worktreePath ?? model.repoPath) : null}
        checkout={model.checkout ?? null}
        targetReference={model.comparisonReference ?? null}
        targetLabel={model.targetBranch}
        comparisonUnavailableReason={model.comparisonUnavailableReason ?? null}
      />
    );
  }

  if (view.activeTab === "uncommitted") {
    return (
      <UncommittedTabContent
        model={model}
        view={view}
        ownerKey={commentOwnerKey}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />
    );
  }

  return (
    <TargetChangesView
      model={model}
      view={view}
      ownerKey={commentOwnerKey}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      listState={view.lists.target}
    />
  );
}

function UncommittedTabContent({
  model,
  view,
  ownerKey,
  viewMode,
  onViewModeChange,
}: {
  model: AgentStudioGitPanelModel;
  view: GitPanelView;
  ownerKey: string | null;
  viewMode: FileListViewMode;
  onViewModeChange: (mode: FileListViewMode) => void;
}): ReactElement {
  const local = model.scopeStatesByScope.uncommitted.localChanges;
  const contextMode = model.contextMode ?? "worktree";
  if (!local || isCleanLocalChanges(local)) {
    // A read that has not finished or that failed must not look like a clean repository.
    return (
      <ScrollArea className="min-h-0 flex-1">
        {!local && model.scopeStatesByScope.uncommitted.error !== null ? (
          <DiffLoadFailedState diffScope="uncommitted" />
        ) : (
          <EmptyDiffState
            isLoading={!local && (!model.loadedScopesByScope.uncommitted || model.isLoading)}
            contextMode={contextMode}
            diffScope="uncommitted"
          />
        )}
      </ScrollArea>
    );
  }
  return (
    <GitLocalChangesView
      subjectKey={model.subjectKey}
      localChanges={local}
      ownerKey={ownerKey}
      commentPlaceholder={model.commentPlaceholder}
      diffStyle={view.diffStyle}
      setDiffStyle={view.setDiffStyle}
      viewMode={viewMode}
      onViewModeChange={onViewModeChange}
      search={view.lists.search}
      listStates={view.lists.local}
      expandedFiles={view.expandedFiles}
      onToggleFile={view.onToggleFile}
      onViewFile={model.onViewFile ?? null}
      collapsedGroups={view.collapsedGroups}
      onToggleGroup={view.onToggleGroup}
      preloadLimit={PRELOAD_DIFF_LIMIT}
      changeDisabledReason={model.changeDisabledReason ?? null}
      changingKey={model.changingKey ?? null}
      onChange={model.changeSelection ?? null}
    />
  );
}

const isCleanLocalChanges = (local: GitLocalChanges): boolean =>
  local.unstaged.fileDiffs.length === 0 &&
  local.staged.fileDiffs.length === 0 &&
  local.conflicted.fileDiffs.length === 0;

function TargetChangesView({
  model,
  view,
  ownerKey,
  viewMode,
  onViewModeChange,
  listState,
}: {
  model: AgentStudioGitPanelModel;
  view: GitPanelView;
  ownerKey: string | null;
  viewMode: FileListViewMode;
  onViewModeChange: (mode: FileListViewMode) => void;
  listState: FileListState;
}): ReactElement {
  const target = model.scopeStatesByScope.target;
  const expandedFiles = useMemo(() => {
    const files = new Set<string>();
    for (const diff of target.fileDiffs) {
      if (view.expandedFiles.has(listFileKey("target", diff.file))) files.add(diff.file);
    }
    return files;
  }, [target.fileDiffs, view.expandedFiles]);
  const conflictedFiles = useMemo(
    () => new Set(collectUnmergedFilePaths(target.fileStatuses)),
    [target.fileStatuses],
  );
  const { onToggleFile } = view;
  const toggleFile = useCallback(
    (filePath: string) => onToggleFile(listFileKey("target", filePath)),
    [onToggleFile],
  );
  if (target.fileDiffs.length === 0) {
    return (
      <ScrollArea className="min-h-0 flex-1">
        {target.error !== null ? (
          <DiffLoadFailedState diffScope="target" />
        ) : (
          <EmptyDiffState
            targetBranch={model.targetBranch}
            isLoading={(model.comparisonPending ?? false) || !model.loadedScopesByScope.target}
            contextMode={model.contextMode ?? "worktree"}
            diffScope="target"
            upstreamStatus={target.upstreamStatus}
          />
        )}
      </ScrollArea>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <FileDiffListWithHeader
        fileDiffs={target.fileDiffs}
        diffScope="target"
        listKey="target"
        listLabel="Branch changes"
        ownerKey={ownerKey}
        commentPlaceholder={model.commentPlaceholder}
        conflictedFiles={conflictedFiles}
        diffStyle={view.diffStyle}
        setDiffStyle={view.setDiffStyle}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        listState={listState}
        expandedFiles={expandedFiles}
        onToggleFile={toggleFile}
        onViewFile={model.onViewFile ?? null}
        preloadLimit={PRELOAD_DIFF_LIMIT}
        rowActions={null}
        changingKey={null}
      />
    </div>
  );
}
