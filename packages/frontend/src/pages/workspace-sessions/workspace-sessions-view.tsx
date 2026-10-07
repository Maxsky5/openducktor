import type { WorkspaceSession } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { useDialogPresence } from "@/components/ui/dialog";
import type { TerminalPanelModel } from "@/features/terminals";
import { useRightPanelOpen } from "@/components/features/agents/use-right-panel-open";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import type { SessionNavigationTarget } from "@/features/session-navigation/session-navigation-target";
import { usePublishVisibleSessionTarget } from "@/features/session-navigation/visible-session-target";
import { workspaceSessionIdentity } from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import { errorMessage } from "@/lib/errors";
import { useArchiveWorkspaceSession } from "@/state/operations/use-archive-workspace-session";
import { workspaceSessionListQueryOptions } from "@/state/queries/workspace-sessions";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  WorkspaceSessionContent,
  WorkspaceSessionReadModelNotice,
  type WorkspaceSessionPanelState,
} from "./workspace-session-content";
import { WorkspaceSessionCreateDialog } from "./workspace-session-create-dialog";
import { WorkspaceSessionEmptyState } from "./workspace-session-empty-state";
import { WorkspaceSessionArchiveDialog } from "./workspace-session-archive-dialog";
import { SessionViewControls } from "@/components/features/agents/session-view-controls";
import { WorkspaceSessionTerminalLayout } from "./workspace-session-terminal-layout";
import { WorkspaceSessionHeader } from "./workspace-session-header";
import { useWorkspaceSessionTerminals } from "./use-workspace-session-terminals";
import { useMountedRef } from "./use-mounted-ref";
import { useWorkspaceSessionNavigation } from "./use-workspace-session-navigation";
import { useWorkspaceSessionSelection } from "./use-workspace-session-selection";
import { useVisibleSessionId } from "./use-visible-session-id";

type WorkspaceSessionsProps = { workspace: ActiveWorkspace };

export function WorkspaceSessions({ workspace }: WorkspaceSessionsProps): ReactElement {
  const { run: guardWorkspaceChange, cancelPending } = useWorkspacePreviewTransitionGuard();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const { sessionId, creating, updateNavigation } = useWorkspaceSessionNavigation({
    workspaceId: workspace.workspaceId,
    locationKey: location.key,
    navigationType,
    searchParams: params,
    setSearchParams: setParams,
  });
  const records = useQuery(workspaceSessionListQueryOptions(workspace.workspaceId));
  const sessions = records.data ?? [];
  const [createWorkspaceId, setCreateWorkspaceId] = useState<string | null>(null);
  const createOpen = createWorkspaceId === workspace.workspaceId;
  if (createWorkspaceId !== null && createWorkspaceId !== workspace.workspaceId) {
    setCreateWorkspaceId(null);
  }
  const [createAttempt, setCreateAttempt] = useState(0);
  const archiveCloseAutoFocusRef = useRef<((event: Event) => void) | null>(null);
  const mounted = useMountedRef();
  const workspaceIdRef = useRef(workspace.workspaceId);
  useLayoutEffect(() => {
    workspaceIdRef.current = workspace.workspaceId;
  }, [workspace.workspaceId]);
  const { selected: requestedSelected, missingSessionId } = useWorkspaceSessionSelection({
    workspaceId: workspace.workspaceId,
    sessions: records.data,
    requestedSessionId: sessionId,
  });
  const requestedSelectedId = requestedSelected?.id ?? null;
  const { visibleSelectedId, leaveRemovedChat, completeArchive } = useVisibleSessionId(
    requestedSelectedId,
    guardWorkspaceChange,
    updateNavigation,
    cancelPending,
    workspace.workspaceId,
  );
  const selected = useVisibleSessionRecord(
    workspace.workspaceId,
    sessions,
    visibleSelectedId,
    requestedSelected,
  );
  const selectedId = selected?.id ?? null;
  const terminalModel = useWorkspaceSessionTerminals({
    workspace,
    selected,
    sessions,
  });
  const { panelState, onPanelStateChange, togglePanel } = useSessionPanelState(
    workspace.workspaceId,
    selectedId,
  );
  useEffect(() => {
    if (records.data && missingSessionId === null && sessionId !== requestedSelectedId)
      updateNavigation({ sessionId: requestedSelectedId });
  }, [missingSessionId, records.data, requestedSelectedId, sessionId, updateNavigation]);
  const visibleTarget = useMemo<SessionNavigationTarget | null>(
    () =>
      selectedId === null
        ? null
        : { kind: "workspace_session", workspaceId: workspace.workspaceId, sessionId: selectedId },
    [selectedId, workspace.workspaceId],
  );
  usePublishVisibleSessionTarget(
    visibleTarget,
    selected ? workspaceSessionIdentity(selected) : null,
  );
  const { archive, archiveTarget, setArchiveTarget, beginArchive } = useWorkspaceSessionArchive({
    workspace,
    mounted,
    selectedId,
    sessions,
    completeArchive,
    guardWorkspaceChange,
  });
  const setCreating = (open: boolean) => {
    if (open) setCreateAttempt((attempt) => attempt + 1);
    setCreateWorkspaceId(open ? workspace.workspaceId : null);
    if (!open && creating) updateNavigation({ creating: false });
  };
  if (records.isPending)
    return (
      <p role="status" className="p-6 text-muted-foreground">
        Loading chats…
      </p>
    );
  // A failed refresh keeps the last records, so only a failed first read replaces the chats.
  if (records.data === undefined)
    return (
      <div role="alert" className="space-y-3 p-6">
        <p className="text-destructive">Could not load chats: {errorMessage(records.error)}</p>
        <Button variant="outline" onClick={() => void records.refetch()}>
          Retry
        </Button>
      </div>
    );
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <WorkspaceSessionReadModelNotice />
      <WorkspaceSessionRecordsRefreshNotice
        error={records.error}
        onRetry={() => void records.refetch()}
      />
      {archiveTarget === null && <WorkspaceSessionArchiveError error={archive.error} />}
      <WorkspaceSessionActiveContent
        workspace={workspace}
        selected={selected}
        sessionIds={sessions.map((record) => record.id)}
        missingSessionId={missingSessionId}
        onDismissMissing={() => updateNavigation({ sessionId: null })}
        terminalModel={terminalModel}
        panelState={panelState}
        onPanelStateChange={onPanelStateChange}
        onSafeToLeave={leaveRemovedChat}
        hasSessions={records.data.length > 0}
        onCreate={() => setCreating(true)}
        viewControls={
          <SessionViewControls
            terminal={terminalModel}
            tools={{ label: "workspace tools", isOpen: panelState.isOpen, onToggle: togglePanel }}
          />
        }
        onArchive={(onCloseAutoFocus) => {
          if (!selected) return;
          archiveCloseAutoFocusRef.current = onCloseAutoFocus;
          archive.reset();
          setArchiveTarget(selected);
        }}
        isArchiving={archive.isPending}
      />
      <WorkspaceSessionDialogs
        key={workspace.workspaceId}
        workspace={workspace}
        archiveTarget={archiveTarget}
        archivePending={archive.isPending}
        archiveError={archive.error}
        onArchiveCloseAutoFocus={(event) => archiveCloseAutoFocusRef.current?.(event)}
        onArchive={beginArchive}
        onArchiveClose={() => {
          setArchiveTarget(null);
          archive.reset();
        }}
        createOpen={createOpen || creating}
        createAttempt={createAttempt}
        onCreateClose={() => setCreating(false)}
        onCreated={(record) => {
          if (mounted.current && workspaceIdRef.current === workspace.workspaceId) {
            setCreateWorkspaceId(null);
            updateNavigation({ sessionId: record.id, creating: false });
          }
        }}
      />
    </div>
  );
}

/** A failed chat-list refresh shows beside the chats, which stay usable. */
function WorkspaceSessionRecordsRefreshNotice({
  error,
  onRetry,
}: {
  error: Error | null;
  onRetry: () => void;
}): ReactElement | null {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-center gap-3 border-b border-border p-3 text-sm">
      <span className="flex-1 text-destructive">
        Could not refresh chats: {errorMessage(error)}
      </span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function WorkspaceSessionActiveContent({
  workspace,
  selected,
  sessionIds,
  missingSessionId,
  onDismissMissing,
  terminalModel,
  panelState,
  onPanelStateChange,
  onSafeToLeave,
  hasSessions,
  onCreate,
  viewControls,
  onArchive,
  isArchiving,
}: {
  workspace: ActiveWorkspace;
  selected: WorkspaceSession | null;
  sessionIds: readonly string[];
  missingSessionId: string | null;
  onDismissMissing: () => void;
  terminalModel: TerminalPanelModel;
  panelState: WorkspaceSessionPanelState;
  onPanelStateChange: (
    sessionId: string,
    update: Partial<Pick<WorkspaceSessionPanelState, "activeTabId" | "selectedFile">>,
  ) => void;
  onSafeToLeave: () => void;
  hasSessions: boolean;
  onCreate: () => void;
  viewControls: ReactNode;
  onArchive: (onCloseAutoFocus: (event: Event) => void) => void;
  isArchiving: boolean;
}): ReactElement {
  // A removed chat stays visible until its draft can leave; then the request shows as unavailable.
  if (!selected && missingSessionId !== null)
    return (
      <section
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-card p-6 text-center"
        role="alert"
      >
        <h1 className="text-lg font-semibold">This chat is unavailable</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The requested workspace session is archived, removed, or not in this workspace. Restore it
          from Archived chats or choose another session.
        </p>
        <Button variant="outline" onClick={onDismissMissing}>
          Close
        </Button>
      </section>
    );
  if (!selected)
    return <WorkspaceSessionEmptyState hasSessions={hasSessions} onCreate={onCreate} />;
  return (
    <>
      <WorkspaceSessionHeader
        key={selected.id}
        workspace={workspace}
        record={selected}
        viewControls={viewControls}
        onArchive={onArchive}
        isArchiving={isArchiving}
      />
      <WorkspaceSessionTerminalLayout model={terminalModel}>
        <WorkspaceSessionContent
          workspace={workspace}
          record={selected}
          sessionIds={sessionIds}
          panelState={panelState}
          onPanelStateChange={onPanelStateChange}
          onSafeToLeave={onSafeToLeave}
        />
      </WorkspaceSessionTerminalLayout>
    </>
  );
}

function useVisibleSessionRecord(
  workspaceId: string,
  sessions: WorkspaceSession[],
  visibleId: string | null,
  fallback: WorkspaceSession | null,
): WorkspaceSession | null {
  const visible = sessions.find((record) => record.id === visibleId) ?? null;
  const lastVisible = useRef<{ workspaceId: string; record: WorkspaceSession } | null>(null);
  useLayoutEffect(() => {
    if (visible) lastVisible.current = { workspaceId, record: visible };
  }, [visible, workspaceId]);
  return (
    visible ??
    (lastVisible.current?.workspaceId === workspaceId && lastVisible.current.record.id === visibleId
      ? lastVisible.current.record
      : fallback)
  );
}

function useSessionPanelState(workspaceId: string, selectedId: string | null) {
  const { isOpen, toggle: togglePanel } = useRightPanelOpen();
  type TabState = Pick<WorkspaceSessionPanelState, "activeTabId" | "selectedFile">;
  const [scope, setScope] = useState<{ workspaceId: string; panels: Record<string, TabState> }>({
    workspaceId,
    panels: {},
  });
  if (scope.workspaceId !== workspaceId) setScope({ workspaceId, panels: {} });
  const panelStates = scope.workspaceId === workspaceId ? scope.panels : {};
  const panelState: WorkspaceSessionPanelState = selectedId
    ? { isOpen, ...(panelStates[selectedId] ?? { activeTabId: "git", selectedFile: null }) }
    : { isOpen: false, activeTabId: "git", selectedFile: null };
  const onPanelStateChange = useCallback(
    (sessionId: string, update: Partial<TabState>) => {
      setScope((current) => {
        if (current.workspaceId !== workspaceId) return current;
        const previous = current.panels[sessionId] ?? {
          activeTabId: "git",
          selectedFile: null,
        };
        const next = { ...previous, ...update };
        if (
          previous.activeTabId === next.activeTabId &&
          previous.selectedFile?.rootPath === next.selectedFile?.rootPath &&
          previous.selectedFile?.relativePath === next.selectedFile?.relativePath
        )
          return current;
        return { ...current, panels: { ...current.panels, [sessionId]: next } };
      });
    },
    [workspaceId],
  );
  return { panelState, onPanelStateChange, togglePanel };
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
  mounted,
  selectedId,
  sessions,
  completeArchive,
  guardWorkspaceChange,
}: {
  workspace: ActiveWorkspace;
  mounted: ReturnType<typeof useMountedRef>;
  selectedId: string | null;
  sessions: WorkspaceSession[];
  completeArchive: ReturnType<typeof useVisibleSessionId>["completeArchive"];
  guardWorkspaceChange: ReturnType<typeof useWorkspacePreviewTransitionGuard>["run"];
}) {
  const [archiveScope, setArchiveScope] = useState<{
    workspaceId: string;
    target: WorkspaceSession | null;
  }>({ workspaceId: workspace.workspaceId, target: null });
  const archiveTarget =
    archiveScope.workspaceId === workspace.workspaceId ? archiveScope.target : null;
  if (archiveScope.workspaceId !== workspace.workspaceId) {
    setArchiveScope({ workspaceId: workspace.workspaceId, target: null });
  }
  const setArchiveTarget = (target: WorkspaceSession | null) =>
    setArchiveScope({ workspaceId: workspace.workspaceId, target });
  const archive = useArchiveWorkspaceSession((record, input) => {
    if (input.workspaceId !== workspace.workspaceId) return;
    if (mounted.current && selectedId === record.id)
      completeArchive(sessions.find((entry) => entry.id !== record.id)?.id ?? null);
    if (mounted.current) setArchiveTarget(null);
  });
  const resetArchive = archive.reset;
  useEffect(() => resetArchive(), [resetArchive, workspace.workspaceId]);
  const beginArchive = (
    sessionId: string,
    removeWorktree: boolean,
    worktreeConfirmation?: { workingDirectory: string; branchName: string },
  ) => {
    const apply = async () => {
      archive.reset();
      try {
        await archive.mutateAsync({
          workspaceId: workspace.workspaceId,
          repoPath: workspace.repoPath,
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
  return { archive, archiveTarget, setArchiveTarget, beginArchive };
}

function WorkspaceSessionDialogs({
  workspace,
  archiveTarget,
  archivePending,
  archiveError,
  onArchiveCloseAutoFocus,
  onArchive,
  onArchiveClose,
  createOpen,
  createAttempt,
  onCreateClose,
  onCreated,
}: {
  workspace: ActiveWorkspace;
  archiveTarget: WorkspaceSession | null;
  archivePending: boolean;
  archiveError: Error | null;
  onArchiveCloseAutoFocus: (event: Event) => void;
  onArchive: (
    sessionId: string,
    removeWorktree: boolean,
    confirmation?: { workingDirectory: string; branchName: string },
  ) => void;
  onArchiveClose: () => void;
  createOpen: boolean;
  createAttempt: number;
  onCreateClose: () => void;
  onCreated: (record: WorkspaceSession) => void;
}): ReactElement {
  const createMounted = useDialogPresence(createOpen);
  const archiveMounted = useDialogPresence(archiveTarget !== null);
  const lastArchiveTarget = useRef(archiveTarget);
  useLayoutEffect(() => {
    if (archiveTarget) lastArchiveTarget.current = archiveTarget;
  }, [archiveTarget]);
  // The closing dialog still needs its record after selection moves to the next chat.
  const closingTarget = archiveTarget ?? lastArchiveTarget.current;
  return (
    <>
      {archiveMounted && closingTarget && (
        <WorkspaceSessionArchiveDialog
          key={closingTarget.id}
          open={archiveTarget !== null}
          onCloseAutoFocus={onArchiveCloseAutoFocus}
          workspaceId={workspace.workspaceId}
          record={closingTarget}
          isArchiving={archivePending}
          error={archiveError}
          onArchive={(removeWorktree, confirmation) =>
            onArchive(closingTarget.id, removeWorktree, confirmation)
          }
          onClose={onArchiveClose}
        />
      )}
      {createMounted && (
        <WorkspaceSessionCreateDialog
          key={`${workspace.workspaceId}-${createAttempt}`}
          open={createOpen}
          workspace={workspace}
          onClose={onCreateClose}
          onCreated={onCreated}
        />
      )}
    </>
  );
}
