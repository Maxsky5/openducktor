import type { BrowserTabOwner, WorkspaceSession } from "@openducktor/contracts";
import { useBrowserPanelModel } from "@/features/browser";
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
import type { SetURLSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { useDialogPresence } from "@/components/ui/dialog";
import type { TaskExecutionSelectedFile } from "@/components/features/agents/task-execution-file-explorer-model";
import {
  BottomPanelSplit,
  type SessionPanelOwner,
  type SessionPanelSplitIds,
  SessionPanelsRoot,
  type SessionPanelsModel,
  useSessionPanels,
} from "@/features/session-panels";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import { SessionNavigationError } from "@/features/session-navigation/session-navigation-error";
import type { SessionNavigationTarget } from "@/features/session-navigation/session-navigation-target";
import { usePublishVisibleSessionTarget } from "@/features/session-navigation/visible-session-target";
import { workspaceSessionIdentity } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useArchiveWorkspaceSession } from "@/state/operations/use-archive-workspace-session";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  WorkspaceSessionContent,
  WorkspaceSessionReadModelNotice,
} from "./workspace-session-content";
import { WorkspaceSessionCreateDialog } from "./workspace-session-create-dialog";
import { WorkspaceSessionEmptyState } from "./workspace-session-empty-state";
import { WorkspaceSessionArchiveDialog } from "./workspace-session-archive-dialog";
import { SessionViewControls } from "@/components/features/agents/session-view-controls";
import { SessionRepoActions } from "@/components/features/repository-actions/session-repo-actions";
import { WorkspaceSessionHeader } from "./workspace-session-header";
import { useWorkspaceSessionTerminals } from "./use-workspace-session-terminals";
import { useMountedRef } from "./use-mounted-ref";
import { useWorkspaceSessionNavigation } from "./use-workspace-session-navigation";
import { useWorkspaceSessionSelection } from "./use-workspace-session-selection";
import { useVisibleSessionId } from "./use-visible-session-id";

export type WorkspaceSessionsViewState = {
  workspace: ActiveWorkspace;
  sessions: WorkspaceSession[];
  recordsError: Error | null;
  searchParams: URLSearchParams;
  locationKey: string;
  navigationType: "POP" | "PUSH" | "REPLACE";
};
type WorkspaceSessionsProps = WorkspaceSessionsViewState & {
  isActive: boolean;
  setSearchParams: SetURLSearchParams;
  retryRecords: () => void;
};

export function WorkspaceSessions({
  workspace,
  sessions,
  recordsError,
  searchParams,
  locationKey,
  navigationType,
  isActive,
  setSearchParams,
  retryRecords,
}: WorkspaceSessionsProps): ReactElement {
  const { run: guardWorkspaceChange, cancelPending } = useWorkspacePreviewTransitionGuard();
  const { sessionId, creating, updateNavigation } = useWorkspaceSessionNavigation({
    workspaceId: workspace.workspaceId,
    locationKey,
    navigationType,
    searchParams,
    setSearchParams,
    enabled: isActive,
  });
  const [createWorkspaceId, setCreateWorkspaceId] = useState<string | null>(null);
  const createOpen = createWorkspaceId === workspace.workspaceId;
  if (createWorkspaceId !== null && (!isActive || createWorkspaceId !== workspace.workspaceId)) {
    setCreateWorkspaceId(null);
  }
  const [createAttempt, setCreateAttempt] = useState(0);
  const archiveCloseAutoFocusRef = useRef<((event: Event) => void) | null>(null);
  const mounted = useMountedRef();
  const workspaceIdRef = useRef(workspace.workspaceId);
  useLayoutEffect(() => {
    workspaceIdRef.current = workspace.workspaceId;
  }, [workspace.workspaceId]);
  const {
    selected: requestedSelected,
    missingSessionId,
    navigationPersistenceError,
    navigationPersistenceOperation,
    retryNavigationPersistence,
    isRetryingNavigationPersistence,
  } = useWorkspaceSessionSelection({
    workspaceId: workspace.workspaceId,
    sessions,
    requestedSessionId: sessionId,
    isActive,
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
  const terminals = useWorkspaceSessionTerminals({
    workspace,
    selected,
  });
  const panelOwner = useMemo<SessionPanelOwner | null>(
    () =>
      selectedId === null
        ? null
        : { kind: "chat", workspaceId: workspace.workspaceId, sessionId: selectedId },
    [selectedId, workspace.workspaceId],
  );
  const browserOwner = useMemo<BrowserTabOwner | null>(
    () =>
      selectedId === null
        ? null
        : { kind: "workspace_session", workspaceId: workspace.workspaceId, sessionId: selectedId },
    [selectedId, workspace.workspaceId],
  );
  const browser = useBrowserPanelModel(browserOwner);
  const panels = useSessionPanels({
    owner: panelOwner,
    selectionKey: "chat",
    terminals,
    shortcutsEnabled: isActive && selectedId !== null,
    browser,
  });
  const { selectedFile, onSelectedFileChange } = useSelectedFiles(
    workspace.workspaceId,
    selectedId,
  );
  useEffect(() => {
    if (
      !navigationPersistenceError &&
      missingSessionId === null &&
      sessionId !== requestedSelectedId
    )
      updateNavigation({ sessionId: requestedSelectedId });
  }, [
    navigationPersistenceError,
    missingSessionId,
    requestedSelectedId,
    sessionId,
    updateNavigation,
  ]);
  const visibleTarget = useMemo<SessionNavigationTarget | null>(
    () =>
      selectedId === null
        ? null
        : { kind: "workspace_session", workspaceId: workspace.workspaceId, sessionId: selectedId },
    [selectedId, workspace.workspaceId],
  );
  usePublishVisibleSessionTarget(
    !isActive || navigationPersistenceError ? null : visibleTarget,
    selected ? workspaceSessionIdentity(selected) : null,
  );
  const { archive, archiveTarget, setArchiveTarget, beginArchive } = useWorkspaceSessionArchive({
    workspace,
    isActive,
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
  if (navigationPersistenceError)
    return (
      <SessionNavigationError
        scopeLabel="Workspace sessions"
        repositoryPath={workspace.repoPath}
        error={navigationPersistenceError}
        operation={navigationPersistenceOperation}
        onRetry={retryNavigationPersistence}
        isPending={isRetryingNavigationPersistence}
      />
    );
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <WorkspaceSessionReadModelNotice />
      <WorkspaceSessionRecordsRefreshNotice error={recordsError} onRetry={retryRecords} />
      {archiveTarget === null && <WorkspaceSessionArchiveError error={archive.error} />}
      <WorkspaceSessionActiveContent
        workspace={workspace}
        selected={selected}
        isVisible={isActive}
        missingSessionId={missingSessionId}
        onDismissMissing={() => updateNavigation({ sessionId: null })}
        panels={panels}
        selectedFile={selectedFile}
        onSelectedFileChange={onSelectedFileChange}
        onSafeToLeave={leaveRemovedChat}
        hasSessions={sessions.length > 0}
        onCreate={() => setCreating(true)}
        viewControls={
          isActive ? (
            <SessionViewControls bottom={panels.bottomToggle} right={panels.rightToggle} />
          ) : null
        }
        onArchive={(onCloseAutoFocus) => {
          if (!selected) return;
          archiveCloseAutoFocusRef.current = onCloseAutoFocus;
          archive.reset();
          setArchiveTarget(selected);
        }}
        isArchiving={archive.isPending}
      />
      {/* Dialog portals sit outside the hidden page, so remove them while inactive. */}
      {isActive && (
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
      )}
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
  isVisible,
  missingSessionId,
  onDismissMissing,
  panels,
  selectedFile,
  onSelectedFileChange,
  onSafeToLeave,
  hasSessions,
  onCreate,
  viewControls,
  onArchive,
  isArchiving,
}: {
  workspace: ActiveWorkspace;
  selected: WorkspaceSession | null;
  isVisible: boolean;
  missingSessionId: string | null;
  onDismissMissing: () => void;
  panels: SessionPanelsModel;
  selectedFile: TaskExecutionSelectedFile | null;
  onSelectedFileChange: (sessionId: string, selectedFile: TaskExecutionSelectedFile | null) => void;
  onSafeToLeave: () => void;
  hasSessions: boolean;
  onCreate: () => void;
  viewControls: ReactNode;
  onArchive: (onCloseAutoFocus: (event: Event) => void) => void;
  isArchiving: boolean;
}): ReactElement {
  const isChatVisible = isVisible && selected !== null;
  return (
    <>
      {isVisible && selected && (
        <WorkspaceSessionHeader
          key={selected.id}
          workspace={workspace}
          record={selected}
          repoActions={
            <SessionRepoActions
              workspace={workspace}
              terminal={{
                startBlockedReason: panels.startBlockedReason,
                onRunAction: panels.runAction,
              }}
            />
          }
          viewControls={viewControls}
          onArchive={onArchive}
          isArchiving={isArchiving}
        />
      )}
      <SessionPanelsRoot panels={panels} isActive={isChatVisible}>
        <BottomPanelSplit
          ids={TERMINAL_PANEL_SPLIT_IDS}
          model={panels.bottom}
          className="min-h-0 min-w-0 flex-1 overflow-hidden"
          mainClassName="flex h-full min-h-0 flex-col"
        >
          {selected && (
            <WorkspaceSessionContent
              workspace={workspace}
              record={selected}
              selectedFile={selectedFile}
              onSelectedFileChange={onSelectedFileChange}
              onSafeToLeave={onSafeToLeave}
              isVisible={isChatVisible}
              rightPanel={panels.right}
            />
          )}
          {!selected &&
            (missingSessionId !== null ? (
              <WorkspaceSessionUnavailable onDismiss={onDismissMissing} />
            ) : (
              <WorkspaceSessionEmptyState hasSessions={hasSessions} onCreate={onCreate} />
            ))}
        </BottomPanelSplit>
      </SessionPanelsRoot>
    </>
  );
}

function WorkspaceSessionUnavailable({ onDismiss }: { onDismiss: () => void }): ReactElement {
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
      <Button variant="outline" onClick={onDismiss}>
        Close
      </Button>
    </section>
  );
}

const TERMINAL_PANEL_SPLIT_IDS: SessionPanelSplitIds = {
  group: "workspace-session-terminal-layout",
  main: "workspace-session-content-panel",
  panel: "workspace-session-terminal-panel",
};

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

/** Keeps the previewed file of each chat in the workspace while the page shows. */
function useSelectedFiles(workspaceId: string, selectedId: string | null) {
  const [scope, setScope] = useState<{
    workspaceId: string;
    files: Record<string, TaskExecutionSelectedFile | null>;
  }>({ workspaceId, files: {} });
  if (scope.workspaceId !== workspaceId) setScope({ workspaceId, files: {} });
  const files = scope.workspaceId === workspaceId ? scope.files : {};
  const selectedFile = selectedId ? (files[selectedId] ?? null) : null;
  const onSelectedFileChange = useCallback(
    (sessionId: string, file: TaskExecutionSelectedFile | null) => {
      setScope((current) => {
        if (current.workspaceId !== workspaceId) return current;
        const previous = current.files[sessionId] ?? null;
        if (previous?.rootPath === file?.rootPath && previous?.relativePath === file?.relativePath)
          return current;
        return { ...current, files: { ...current.files, [sessionId]: file } };
      });
    },
    [workspaceId],
  );
  return { selectedFile, onSelectedFileChange };
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
  isActive,
  mounted,
  selectedId,
  sessions,
  completeArchive,
  guardWorkspaceChange,
}: {
  workspace: ActiveWorkspace;
  isActive: boolean;
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
  if (
    archiveScope.workspaceId !== workspace.workspaceId ||
    (!isActive && archiveScope.target !== null)
  ) {
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
