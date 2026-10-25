import type { GitChangeGroup } from "@openducktor/contracts";
import { memo, type ReactElement, useCallback, useId, useMemo, useState } from "react";
import type { PierreDiffStyle } from "@/components/features/agents/pierre-diff-viewer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { applyPendingChanges } from "@openducktor/frontend-core/git/model/pending-local-changes";
import { GitConflictStrip } from "@/features/git-conflict-resolution";
import { CommitComposer } from "./commit-composer";
import type { GitPanelTab } from "./constants";
import { AgentStudioGitPanelDialogs } from "./git-panel-dialogs";
import { getGitInfoHeaderProps } from "./git-panel-header-props";
import { AgentStudioGitTabContent } from "./git-panel-tab-content";
import {
  gitPanelContextKey,
  useGitPanelViewField,
  useGitPanelViewUpdate,
} from "./git-panel-view-store";
import { GitInfoHeader } from "./git-info-header";
import type { AgentStudioGitPanelModel, GitPanelView } from "./types";
import { useExpandedFileSelection } from "./use-expanded-file-selection";
import { useGitConflictPanel } from "./use-git-conflict-panel";
import { usePanelFileLists } from "./use-panel-file-lists";

/** Shows Stage and Unstage requests at once. The Git result replaces them when it arrives. */
function withPendingChanges(model: AgentStudioGitPanelModel): AgentStudioGitPanelModel {
  const local = model.scopeStatesByScope.uncommitted;
  const pending = model.pendingChanges ?? [];
  if (!local.localChanges || pending.length === 0) return model;
  return {
    ...model,
    scopeStatesByScope: {
      ...model.scopeStatesByScope,
      uncommitted: { ...local, localChanges: applyPendingChanges(local.localChanges, pending) },
    },
  };
}

export const AgentStudioGitPanel = memo(function AgentStudioGitPanel({
  model: source,
}: {
  model: AgentStudioGitPanelModel;
}): ReactElement {
  const model = useMemo(() => withPendingChanges(source), [source]);
  const contextKey = gitPanelContextKey(model);
  const updateView = useGitPanelViewUpdate(contextKey);
  const activeTab = useGitPanelViewField(contextKey, "selectedTab");
  const collapsedGroups = useGitPanelViewField(contextKey, "collapsedGroups");
  const expandedSelection = useExpandedFileSelection(contextKey);
  const onTabChange = useCallback(
    (tab: GitPanelTab): void => updateView(() => ({ selectedTab: tab })),
    [updateView],
  );
  // The toggle reads the current view, so it stays one callback and two quick toggles both count.
  const onToggleGroup = useCallback(
    (group: GitChangeGroup) =>
      updateView(({ collapsedGroups: current }) => ({
        collapsedGroups: current.includes(group)
          ? current.filter((entry) => entry !== group)
          : [...current, group],
      })),
    [updateView],
  );
  const [diffStyle, setDiffStyle] = useState<PierreDiffStyle>("unified");
  const conflict = useGitConflictPanel(model);
  const lists = usePanelFileLists(model);

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <AgentStudioGitPanelContent
          model={model}
          view={{
            contextKey,
            activeTab,
            onTabChange,
            conflict,
            expandedFiles: expandedSelection.files,
            onToggleFile: expandedSelection.toggle,
            collapsedGroups,
            onToggleGroup,
            diffStyle,
            setDiffStyle,
            lists,
          }}
        />
        <AgentStudioGitPanelDialogs model={model} conflict={conflict} />
      </div>
    </TooltipProvider>
  );
});

function AgentStudioGitPanelContent({
  model,
  view,
}: {
  model: AgentStudioGitPanelModel;
  view: GitPanelView;
}): ReactElement {
  const diffPanelId = `${useId()}-diff`;
  const local = model.scopeStatesByScope.uncommitted.localChanges;
  const { refresh } = model;
  // The panel shows refresh failures. Keep a read failure out of the app error boundary.
  const onRefresh = useCallback(() => void refresh().catch(() => {}), [refresh]);
  return (
    <>
      <GitInfoHeader
        key={model.subjectKey}
        {...getGitInfoHeaderProps(model, view, onRefresh)}
        diffPanelId={diffPanelId}
      />
      <PanelNotices model={model} view={view} />
      <div
        id={diffPanelId}
        role="tabpanel"
        aria-labelledby={`${diffPanelId}-tab-${view.activeTab}`}
        aria-busy={model.isLoading || undefined}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <AgentStudioGitTabContent model={model} view={view} />
      </div>
      {view.activeTab === "uncommitted" ? (
        <CommitComposer
          contextKey={view.contextKey}
          stagedFileCount={local?.staged.fileStatuses.length ?? 0}
          changedFileCount={changedPathCount(local)}
          hasConflicts={(local?.conflicted.fileStatuses.length ?? 0) > 0}
          committingMode={model.committingMode ?? null}
          blockedReason={writeBlockedReason(model)}
          commitError={model.commitError ?? null}
          commit={model.commit ?? null}
        />
      ) : null}
    </>
  );
}

/** Paths that Commit all would stage. Conflicts stay out of this count. */
function changedPathCount(
  local: AgentStudioGitPanelModel["scopeStatesByScope"]["uncommitted"]["localChanges"],
): number {
  if (!local) return 0;
  const paths = new Set<string>();
  for (const entry of [...local.unstaged.fileStatuses, ...local.staged.fileStatuses]) {
    paths.add(entry.path);
  }
  return paths.size;
}

/** Why a commit cannot start now. Other actions in flight and conflict locks block it. */
function writeBlockedReason(model: AgentStudioGitPanelModel): string | null {
  if (model.isGitActionsLocked) return model.gitActionsLockReason ?? "Git actions are disabled.";
  if (model.isPushing) return "Wait for the push to finish.";
  if (model.isRebasing) return "Wait for the rebase or pull to finish.";
  if (model.isChanging) return "Wait for the Git change to finish.";
  if (!model.scopeStatesByScope.uncommitted.localChanges) {
    return "Local changes are unavailable. Refresh and try again.";
  }
  return null;
}

function PanelNotices({
  model,
  view,
}: {
  model: AgentStudioGitPanelModel;
  view: GitPanelView;
}): ReactElement {
  const scopeError =
    view.activeTab === "history" ? null : model.scopeStatesByScope[view.activeTab].error;
  return (
    <>
      {model.changeError ? (
        <p
          role="alert"
          className="border-b border-border bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
          data-testid="agent-studio-git-change-error"
        >
          {model.changeError}
        </p>
      ) : null}
      {scopeError ? (
        <p
          role="alert"
          className="border-b border-border bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
        >
          {scopeError}
        </p>
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
