import type { ArchiveFileDraft } from "@openducktor/frontend-core/operations/background-operation-store";
import { workspaceSessionTitle } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
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
  useSyncExternalStore,
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
import type { SessionNavigationTarget } from "@openducktor/frontend-core/sessions/navigation/session-navigation-target";
import { usePublishVisibleSessionTarget } from "@openducktor/frontend-core/sessions/navigation/visible-session-target";
import {
  OnSessionViewHide,
  WhileSessionViewShown,
} from "@/features/session-navigation/session-view-visibility";
import { workspaceSessionIdentity } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useArchiveWorkspaceSession } from "@openducktor/frontend-core/workspace-sessions/use-archive-workspace-session";
import { useOpenNewWorkspaceSession } from "@/features/session-navigation/use-open-new-workspace-session";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  WorkspaceSessionContent,
  WorkspaceSessionReadModelNotice,
} from "./workspace-session-content";
import { WorkspaceSessionDraftView } from "./workspace-session-draft-view";
import { WorkspaceSessionEmptyState } from "./workspace-session-empty-state";
import { WorkspaceSessionArchiveDialog } from "./workspace-session-archive-dialog";
import { SessionViewControls } from "@/components/features/agents/session-view-controls";
import { SessionRepoActions } from "@/components/features/repository-actions/session-repo-actions";
import { type HeaderChromeReveal, WorkspaceSessionHeader } from "./workspace-session-header";
import { useWorkspaceSessionTerminals } from "./use-workspace-session-terminals";
import { useMountedRef } from "@openducktor/frontend-core/lib/use-mounted-ref";
import {
  useHandedOffSessionState,
  useWorkspaceSessionDraftLifecycle,
} from "./use-workspace-session-draft-lifecycle";
import { useWorkspaceSessionSelection } from "./use-workspace-session-selection";
import { useVisibleSessionId } from "./use-visible-session-id";
import {
  PageToolDetailsProvider,
  usePageToolDetails,
} from "@/features/session-panels/page-tool-details";

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
  const openNewWorkspaceSession = useOpenNewWorkspaceSession();
  const { run: guardWorkspaceChange, cancelPending } = useWorkspacePreviewTransitionGuard();
  const archiveCloseAutoFocusRef = useRef<((event: Event) => void) | null>(null);
  const mounted = useMountedRef();
  const {
    isLive,
    sessionId,
    draftId,
    updateNavigation,
    matchingDraft,
    handedOffSession,
    setHandedOffSession,
    handleDiscardDraft,
    handleSwitchDraftWorkspace,
    handleSavedDraftRecord,
  } = useWorkspaceSessionDraftLifecycle({
    workspaceId: workspace.workspaceId,
    locationKey,
    navigationType,
    searchParams,
    setSearchParams,
    isActive,
    sessions,
    mounted,
  });
  const isDraftMode = draftId !== null;
  const effectiveSessions = useMemo(
    () =>
      handedOffSession &&
      handedOffSession.workspaceId === workspace.workspaceId &&
      !sessions.some((entry) => entry.id === handedOffSession.id)
        ? [handedOffSession.record, ...sessions]
        : sessions,
    [handedOffSession, sessions, workspace.workspaceId],
  );

  const {
    selected: requestedSelected,
    missingSessionId,
    navigationPersistenceError,
    navigationPersistenceOperation,
    retryNavigationPersistence,
    isRetryingNavigationPersistence,
  } = useWorkspaceSessionSelection({
    workspaceId: workspace.workspaceId,
    sessions: effectiveSessions,
    requestedSessionId: sessionId,
    isActive,
    draftActive: isDraftMode,
  });
  const requestedSelectedId = isDraftMode ? null : (requestedSelected?.id ?? null);
  const { visibleSelectedId, leaveRemovedChat, completeArchive } = useVisibleSessionId(
    requestedSelectedId,
    guardWorkspaceChange,
    updateNavigation,
    cancelPending,
    workspace.workspaceId,
  );
  const { backgroundOperations } = useClientConnection();
  const archiveSessionId = sessionId === undefined ? visibleSelectedId : sessionId;
  const hasCompletedArchive = () =>
    archiveSessionId !== null &&
    backgroundOperations.hasCompletedArchive(workspace, archiveSessionId);
  const archiveCompleted = useSyncExternalStore(
    backgroundOperations.subscribe,
    hasCompletedArchive,
    hasCompletedArchive,
  );
  useEffect(() => {
    if (
      !isActive ||
      isDraftMode ||
      !archiveCompleted ||
      archiveSessionId === null ||
      effectiveSessions.some((record) => record.id === archiveSessionId)
    )
      return;
    if (!backgroundOperations.consumeCompletedArchive(workspace, archiveSessionId)) return;
    cancelPending();
    completeArchive(effectiveSessions[0]?.id ?? null);
  }, [
    archiveCompleted,
    archiveSessionId,
    backgroundOperations,
    cancelPending,
    completeArchive,
    effectiveSessions,
    isActive,
    isDraftMode,
    workspace,
  ]);
  const resolvedSelected = useVisibleSessionRecord(
    workspace.workspaceId,
    effectiveSessions,
    visibleSelectedId,
    requestedSelected,
  );
  const selected = isDraftMode ? null : resolvedSelected;
  const selectedId = selected?.id ?? null;
  const { deferRightReveal, headerChromeReveal, startupTitleFallback } = useHandedOffSessionState(
    workspace.workspaceId,
    selectedId,
    isDraftMode,
    handedOffSession,
    setHandedOffSession,
  );
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
  const toolDetails = usePageToolDetails(selectedId);
  const panels = useSessionPanels({
    owner: panelOwner,
    selectionKey: "chat",
    terminals,
    browser,
    toolCallTab: toolDetails.toolCallTab,
    deferRightReveal,
  });
  const { selectedFile, onSelectedFileChange } = useSelectedFiles(
    workspace.workspaceId,
    selectedId,
  );
  useEffect(() => {
    if (
      !isDraftMode &&
      !navigationPersistenceError &&
      missingSessionId === null &&
      sessionId !== requestedSelectedId
    )
      updateNavigation({ sessionId: requestedSelectedId });
  }, [
    isDraftMode,
    navigationPersistenceError,
    missingSessionId,
    requestedSelectedId,
    sessionId,
    updateNavigation,
  ]);
  const matchingDraftId = matchingDraft?.id ?? null;
  const visibleTarget = useMemo<SessionNavigationTarget | null>(() => {
    if (matchingDraftId !== null) {
      return {
        kind: "workspace_session_draft",
        workspaceId: workspace.workspaceId,
        draftId: matchingDraftId,
      };
    }
    return selectedId === null
      ? null
      : { kind: "workspace_session", workspaceId: workspace.workspaceId, sessionId: selectedId };
  }, [matchingDraftId, selectedId, workspace.workspaceId]);
  usePublishVisibleSessionTarget(
    !isLive || navigationPersistenceError ? null : visibleTarget,
    selected ? workspaceSessionIdentity(selected) : null,
  );
  const { archive, archiveTarget, setArchiveTarget, beginArchive } = useWorkspaceSessionArchive({
    workspace,
    isActive,
    selectedId,
    guardWorkspaceChange,
  });
  const handleCreate = useCallback(() => {
    openNewWorkspaceSession(workspace.workspaceId);
  }, [openNewWorkspaceSession, workspace.workspaceId]);
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
      {isDraftMode ? (
        matchingDraft ? (
          <WorkspaceSessionDraftView
            key={matchingDraft.id}
            workspace={workspace}
            draft={matchingDraft}
            onDiscard={handleDiscardDraft}
            onSwitchWorkspace={handleSwitchDraftWorkspace}
            onSavedRecord={handleSavedDraftRecord}
          />
        ) : null
      ) : (
        <PageToolDetailsProvider details={toolDetails}>
          <WorkspaceSessionActiveContent
            workspace={workspace}
            selected={selected}
            isActive={isActive}
            panels={panels}
            viewControls={
              <SessionViewControls bottom={panels.bottomToggle} right={panels.rightToggle} />
            }
            selection={{
              missingSessionId,
              onDismissMissing: () => updateNavigation({ sessionId: null }),
              onSafeToLeave: leaveRemovedChat,
              hasSessions: effectiveSessions.length > 0,
              onCreate: handleCreate,
            }}
            fileSelection={{ selectedFile, onSelectedFileChange }}
            header={{
              onArchive: (onCloseAutoFocus) => {
                if (!selected) return;
                archiveCloseAutoFocusRef.current = onCloseAutoFocus;
                setArchiveTarget(selected);
              },
              isArchiving: archive.isPending,
              chromeReveal: headerChromeReveal,
              startupTitleFallback,
            }}
          />
        </PageToolDetailsProvider>
      )}
      <OnSessionViewHide
        onHide={() => {
          if (archiveTarget !== null) setArchiveTarget(null);
        }}
      />
      {isActive && (
        <WhileSessionViewShown>
          <WorkspaceSessionDialogs
            key={workspace.workspaceId}
            workspace={workspace}
            archiveTarget={archiveTarget}
            archivePending={archive.isPending}
            onArchiveCloseAutoFocus={(event) => archiveCloseAutoFocusRef.current?.(event)}
            onArchive={beginArchive}
            onArchiveClose={() => {
              setArchiveTarget(null);
            }}
          />
        </WhileSessionViewShown>
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
        Could not refresh sessions: {errorMessage(error)}
      </span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

type WorkspaceSessionActiveSelection = {
  missingSessionId: string | null;
  onDismissMissing: () => void;
  onSafeToLeave: () => void;
  hasSessions: boolean;
  onCreate: () => void;
};

type WorkspaceSessionActiveFileSelection = {
  selectedFile: TaskExecutionSelectedFile | null;
  onSelectedFileChange: (sessionId: string, selectedFile: TaskExecutionSelectedFile | null) => void;
};

type WorkspaceSessionActiveHeader = {
  onArchive: (onCloseAutoFocus: (event: Event) => void) => void;
  isArchiving: boolean;
  chromeReveal: HeaderChromeReveal;
  startupTitleFallback: string | null;
};

function WorkspaceSessionActiveContent({
  workspace,
  selected,
  isActive,
  panels,
  viewControls,
  selection,
  fileSelection,
  header,
}: {
  workspace: ActiveWorkspace;
  selected: WorkspaceSession | null;
  isActive: boolean;
  panels: SessionPanelsModel;
  viewControls: ReactNode;
  selection: WorkspaceSessionActiveSelection;
  fileSelection: WorkspaceSessionActiveFileSelection;
  header: WorkspaceSessionActiveHeader;
}): ReactElement {
  const isChatActive = isActive && selected !== null;
  return (
    <>
      {/* Header dialogs and menus sit in portals, so the header leaves as soon as the view hides. */}
      {selected && (
        <WhileSessionViewShown>
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
            onArchive={header.onArchive}
            isArchiving={header.isArchiving}
            chromeReveal={header.chromeReveal}
            startupTitleFallback={header.startupTitleFallback}
          />
        </WhileSessionViewShown>
      )}
      <SessionPanelsRoot panels={panels} isActive={isChatActive}>
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
              selectedFile={fileSelection.selectedFile}
              onSelectedFileChange={fileSelection.onSelectedFileChange}
              onSafeToLeave={selection.onSafeToLeave}
              isActive={isChatActive}
              rightPanel={panels.right}
            />
          )}
          {!selected &&
            (selection.missingSessionId !== null ? (
              <WorkspaceSessionUnavailable onDismiss={selection.onDismissMissing} />
            ) : (
              <WorkspaceSessionEmptyState
                hasSessions={selection.hasSessions}
                onCreate={selection.onCreate}
              />
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
      <h1 className="text-lg font-semibold">This session is unavailable</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The requested workspace session is archived, removed, or not in this workspace. Restore it
        from Archived sessions or choose another session.
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

function useWorkspaceSessionArchive({
  workspace,
  isActive,
  selectedId,
  guardWorkspaceChange,
}: {
  workspace: ActiveWorkspace;
  isActive: boolean;
  selectedId: string | null;
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
  const archive = useArchiveWorkspaceSession(
    workspace.workspaceId,
    archiveTarget?.id ?? selectedId,
  );
  const beginArchive = (
    sessionId: string,
    removeWorktree: boolean,
    worktreeConfirmation?: { workingDirectory: string; branchName: string },
  ) => {
    const apply = (draft?: ArchiveFileDraft) => {
      archive.submit(
        {
          workspaceId: workspace.workspaceId,
          repoPath: workspace.repoPath,
          sessionId,
          confirmStop: true,
          removeWorktree,
          worktreeConfirmation,
        },
        {
          workspaceLabel: workspace.workspaceName,
          targetLabel: archiveTarget ? workspaceSessionTitle(archiveTarget) : sessionId,
        },
        draft,
      );
      setArchiveTarget(null);
    };
    if (sessionId === selectedId)
      guardWorkspaceChange(apply, undefined, { waitForSuccess: true, kind: "archive_chat" });
    else apply();
  };
  return { archive, archiveTarget, setArchiveTarget, beginArchive };
}

function WorkspaceSessionDialogs({
  workspace,
  archiveTarget,
  archivePending,
  onArchiveCloseAutoFocus,
  onArchive,
  onArchiveClose,
}: {
  workspace: ActiveWorkspace;
  archiveTarget: WorkspaceSession | null;
  archivePending: boolean;
  onArchiveCloseAutoFocus: (event: Event) => void;
  onArchive: (
    sessionId: string,
    removeWorktree: boolean,
    confirmation?: { workingDirectory: string; branchName: string },
  ) => void;
  onArchiveClose: () => void;
}): ReactElement | null {
  const archiveMounted = useDialogPresence(archiveTarget !== null);
  const lastArchiveTarget = useRef(archiveTarget);
  useLayoutEffect(() => {
    if (archiveTarget) lastArchiveTarget.current = archiveTarget;
  }, [archiveTarget]);
  // The closing dialog still needs its record after selection moves to the next chat.
  const closingTarget = archiveTarget ?? lastArchiveTarget.current;
  if (!archiveMounted || !closingTarget) return null;
  return (
    <WorkspaceSessionArchiveDialog
      key={closingTarget.id}
      open={archiveTarget !== null}
      onCloseAutoFocus={onArchiveCloseAutoFocus}
      workspaceId={workspace.workspaceId}
      record={closingTarget}
      isArchiving={archivePending}
      onArchive={(removeWorktree, confirmation) =>
        onArchive(closingTarget.id, removeWorktree, confirmation)
      }
      onClose={onArchiveClose}
    />
  );
}
