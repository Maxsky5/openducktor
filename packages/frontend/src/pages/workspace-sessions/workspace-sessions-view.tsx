import type { WorkspaceSession } from "@openducktor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Import, Plus } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { BrowserTabsBar, BrowserTabsRoot } from "@/components/ui/browser-tabs";
import { SharedToolsPanelToggleButton } from "@/components/features/agents/shared-tools-panel";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import { errorMessage } from "@/lib/errors";
import { host } from "@/state/operations/host";
import { invalidateRepoBranchesQuery } from "@/state/queries/git";
import {
  updateWorkspaceSessionQueries,
  workspaceSessionListQueryOptions,
} from "@/state/queries/workspace-sessions";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  WorkspaceSessionContent,
  WorkspaceSessionReadModelNotice,
  type WorkspaceSessionPanelState,
} from "./workspace-session-content";
import { WorkspaceSessionCreateDialog } from "./workspace-session-create-dialog";
import { WorkspaceSessionEmptyState } from "./workspace-session-empty-state";
import { WorkspaceSessionHistoryDialog } from "./workspace-session-history-dialog";
import { WorkspaceSessionImportDialog } from "./workspace-session-import-dialog";
import { WorkspaceSessionArchiveDialog } from "./workspace-session-archive-dialog";
import { WorkspaceSessionTabs } from "./workspace-session-tabs";
import { useMountedRef } from "./use-mounted-ref";
import { useWorkspaceSessionNavigation } from "./use-workspace-session-navigation";
import { useWorkspaceSessionSelection } from "./use-workspace-session-selection";
import { useWorkspaceSessionTabOrder } from "./use-workspace-session-tab-order";
import { useVisibleSessionId } from "./use-visible-session-id";

type WorkspaceSessionsProps = { workspace: ActiveWorkspace };

export function WorkspaceSessions({ workspace }: WorkspaceSessionsProps): ReactElement {
  const { run: guardWorkspaceChange } = useWorkspacePreviewTransitionGuard();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const { sessionId, creating, updateNavigation } = useWorkspaceSessionNavigation({
    locationKey: location.key,
    navigationType,
    searchParams: params,
    setSearchParams: setParams,
  });
  const records = useQuery(workspaceSessionListQueryOptions(workspace.workspaceId));
  const { sessions: orderedSessions, reorder } = useWorkspaceSessionTabOrder(
    workspace.workspaceId,
    records.data,
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const mounted = useMountedRef();
  const requestedSelected = useWorkspaceSessionSelection({
    workspaceId: workspace.workspaceId,
    sessions: records.data === undefined ? undefined : orderedSessions,
    requestedSessionId: sessionId,
  });
  const requestedSelectedId = requestedSelected?.id ?? null;
  const visibleSelectedId = useVisibleSessionId(
    requestedSelectedId,
    guardWorkspaceChange,
    updateNavigation,
  );
  const selected =
    orderedSessions.find((record) => record.id === visibleSelectedId) ?? requestedSelected;
  const selectedId = selected?.id ?? null;
  const { panelState, onPanelStateChange } = useSessionPanelState(selectedId);
  useEffect(() => {
    if (records.data && sessionId !== requestedSelectedId)
      updateNavigation({ sessionId: requestedSelectedId });
  }, [records.data, requestedSelectedId, sessionId, updateNavigation]);
  const { archive, archiveTarget, setArchiveTarget, beginArchive, handleTabArchive } =
    useWorkspaceSessionArchive({
      workspace,
      queryClient,
      mounted,
      selectedId,
      orderedSessions,
      updateNavigation,
      guardWorkspaceChange,
    });
  const archivingId = archive.isPending ? (archive.variables?.sessionId ?? null) : null;
  const setCreating = (open: boolean) => {
    setCreateOpen(open);
    if (!open && creating) updateNavigation({ creating: false });
  };
  if (records.isPending)
    return (
      <p role="status" className="p-6 text-muted-foreground">
        Loading chats…
      </p>
    );
  if (records.isError)
    return (
      <div role="alert" className="space-y-3 p-6">
        <p className="text-destructive">Could not load chats: {errorMessage(records.error)}</p>
        <Button variant="outline" onClick={() => void records.refetch()}>
          Retry
        </Button>
      </div>
    );
  return (
    <BrowserTabsRoot
      value={selectedId ?? ""}
      onValueChange={(sessionId) => updateNavigation({ sessionId }, false)}
      className="h-full min-h-0 min-w-0 gap-0 overflow-hidden"
    >
      <BrowserTabsBar
        className="agent-studio-titlebar-safe-area electron-titlebar-safe-area bg-studio-chrome"
        createAction={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 rounded-md border-none border-transparent bg-transparent p-0 text-studio-chrome-foreground shadow-none hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            aria-label="New chat"
            title="New chat"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-5" />
          </Button>
        }
        actions={
          <>
            {selected ? (
              <SharedToolsPanelToggleButton
                label="workspace tools"
                isOpen={panelState.isOpen}
                onToggle={() => onPanelStateChange({ isOpen: !panelState.isOpen })}
              />
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-studio-chrome-foreground hover:bg-transparent"
              aria-label="Import session"
              title="Import session"
              onClick={() => setImportOpen(true)}
            >
              <Import />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-studio-chrome-foreground hover:bg-transparent"
              aria-label="Session history"
              title="Archived chats"
              onClick={() => setHistoryOpen(true)}
            >
              <History />
            </Button>
          </>
        }
      >
        <WorkspaceSessionTabs
          sessions={orderedSessions}
          selectedId={selectedId}
          archivingId={archivingId}
          pending={archive.isPending}
          onReorder={reorder}
          onArchive={handleTabArchive}
        />
      </BrowserTabsBar>
      <WorkspaceSessionReadModelNotice />
      {archiveTarget === null && <WorkspaceSessionArchiveError error={archive.error} />}
      {selected ? (
        <WorkspaceSessionContent
          key={selected.id}
          workspace={workspace}
          record={selected}
          panelState={panelState}
          onPanelStateChange={onPanelStateChange}
        />
      ) : (
        <WorkspaceSessionEmptyState
          hasSessions={records.data.length > 0}
          onCreate={() => setCreating(true)}
        />
      )}
      <WorkspaceSessionDialogs
        workspace={workspace}
        importOpen={importOpen}
        onImportClose={() => setImportOpen(false)}
        onImported={(record) => {
          if (mounted.current) updateNavigation({ sessionId: record.id, creating: false });
        }}
        historyOpen={historyOpen}
        onHistoryClose={() => setHistoryOpen(false)}
        archiveTarget={archiveTarget}
        archivePending={archive.isPending}
        archiveError={archive.error}
        onArchive={beginArchive}
        onArchiveClose={() => {
          setArchiveTarget(null);
          archive.reset();
        }}
        createOpen={createOpen || creating}
        onCreateClose={() => setCreating(false)}
        onCreated={(record) => {
          if (mounted.current) {
            setCreateOpen(false);
            updateNavigation({ sessionId: record.id, creating: false });
          }
        }}
      />
    </BrowserTabsRoot>
  );
}

function useSessionPanelState(selectedId: string | null) {
  const [panelStates, setPanelStates] = useState<Record<string, WorkspaceSessionPanelState>>({});
  const panelState: WorkspaceSessionPanelState = selectedId
    ? (panelStates[selectedId] ?? { isOpen: true, activeTabId: "git", selectedFile: null })
    : { isOpen: false, activeTabId: "git", selectedFile: null };
  const onPanelStateChange = useCallback(
    (update: Partial<WorkspaceSessionPanelState>) => {
      if (!selectedId) return;
      setPanelStates((current) => {
        const previous = current[selectedId] ?? {
          isOpen: true,
          activeTabId: "git",
          selectedFile: null,
        };
        const next = { ...previous, ...update };
        if (
          previous.isOpen === next.isOpen &&
          previous.activeTabId === next.activeTabId &&
          previous.selectedFile?.rootPath === next.selectedFile?.rootPath &&
          previous.selectedFile?.relativePath === next.selectedFile?.relativePath
        )
          return current;
        return { ...current, [selectedId]: next };
      });
    },
    [selectedId],
  );
  return { panelState, onPanelStateChange };
}

function WorkspaceSessionArchiveError({ error }: { error: Error | null }): ReactElement | null {
  if (!error) return null;
  return (
    <p role="alert" className="p-3 text-sm text-destructive">
      {errorMessage(error)}
    </p>
  );
}

function useWorkspaceSessionArchive({
  workspace,
  queryClient,
  mounted,
  selectedId,
  orderedSessions,
  updateNavigation,
  guardWorkspaceChange,
}: {
  workspace: ActiveWorkspace;
  queryClient: ReturnType<typeof useQueryClient>;
  mounted: ReturnType<typeof useMountedRef>;
  selectedId: string | null;
  orderedSessions: WorkspaceSession[];
  updateNavigation: ReturnType<typeof useWorkspaceSessionNavigation>["updateNavigation"];
  guardWorkspaceChange: ReturnType<typeof useWorkspacePreviewTransitionGuard>["run"];
}) {
  const [archiveTarget, setArchiveTarget] = useState<WorkspaceSession | null>(null);
  const archive = useMutation({
    mutationFn: (input: {
      sessionId: string;
      confirmStop: boolean;
      removeWorktree: boolean;
      worktreeConfirmation?: { workingDirectory: string; branchName: string } | undefined;
    }) => host.workspaceSessionArchive({ workspaceId: workspace.workspaceId, ...input }),
    onSuccess: (record) => {
      updateWorkspaceSessionQueries(queryClient, workspace.workspaceId, record);
      if (!mounted.current) return;
      setArchiveTarget(null);
      if (selectedId === record.id)
        updateNavigation({
          sessionId: orderedSessions.find((entry) => entry.id !== record.id)?.id ?? null,
        });
    },
    onSettled: () => {
      void invalidateRepoBranchesQuery(queryClient, workspace.repoPath);
    },
  });
  const beginArchive = (
    sessionId: string,
    removeWorktree: boolean,
    worktreeConfirmation?: { workingDirectory: string; branchName: string },
  ) => {
    const apply = async () => {
      archive.reset();
      try {
        await archive.mutateAsync({
          sessionId,
          confirmStop: true,
          removeWorktree,
          worktreeConfirmation,
        });
        return true;
      } catch {
        return false;
      }
    };
    if (sessionId === selectedId) guardWorkspaceChange(apply, undefined, { waitForSuccess: true });
    else void apply();
  };
  const handleTabArchive = (target: WorkspaceSession) => {
    archive.reset();
    if (target.executionTarget.kind === "local_worktree") {
      setArchiveTarget(target);
      return;
    }
    beginArchive(target.id, false);
  };
  return { archive, archiveTarget, setArchiveTarget, beginArchive, handleTabArchive };
}

function WorkspaceSessionDialogs({
  workspace,
  importOpen,
  onImportClose,
  onImported,
  historyOpen,
  onHistoryClose,
  archiveTarget,
  archivePending,
  archiveError,
  onArchive,
  onArchiveClose,
  createOpen,
  onCreateClose,
  onCreated,
}: {
  workspace: ActiveWorkspace;
  importOpen: boolean;
  onImportClose: () => void;
  onImported: (record: WorkspaceSession) => void;
  historyOpen: boolean;
  onHistoryClose: () => void;
  archiveTarget: WorkspaceSession | null;
  archivePending: boolean;
  archiveError: Error | null;
  onArchive: (
    sessionId: string,
    removeWorktree: boolean,
    confirmation?: { workingDirectory: string; branchName: string },
  ) => void;
  onArchiveClose: () => void;
  createOpen: boolean;
  onCreateClose: () => void;
  onCreated: (record: WorkspaceSession) => void;
}): ReactElement {
  return (
    <>
      {importOpen && (
        <WorkspaceSessionImportDialog
          workspaceId={workspace.workspaceId}
          onClose={onImportClose}
          onImported={onImported}
        />
      )}
      {historyOpen && (
        <WorkspaceSessionHistoryDialog
          workspaceId={workspace.workspaceId}
          repoPath={workspace.repoPath}
          onClose={onHistoryClose}
        />
      )}
      {archiveTarget && (
        <WorkspaceSessionArchiveDialog
          key={archiveTarget.id}
          workspaceId={workspace.workspaceId}
          record={archiveTarget}
          isArchiving={archivePending}
          error={archiveError}
          onArchive={(removeWorktree, confirmation) =>
            onArchive(archiveTarget.id, removeWorktree, confirmation)
          }
          onClose={onArchiveClose}
        />
      )}
      {createOpen && (
        <WorkspaceSessionCreateDialog
          workspace={workspace}
          onClose={onCreateClose}
          onCreated={onCreated}
        />
      )}
    </>
  );
}
