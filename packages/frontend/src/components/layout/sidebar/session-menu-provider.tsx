import type { ArchiveFileDraft } from "@openducktor/frontend-core/operations/background-operation-store";
import { workspaceSessionTitle } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import type { WorkspaceSession, WorkspaceSessionArchiveInput } from "@openducktor/contracts";
import type { WorkspaceSessionDraftLifecycle } from "@openducktor/frontend-core/drafts/new-workspace-session-draft-store";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import { DiscardWorkspaceSessionDraftDialog } from "@/components/features/workspace-sessions/discard-workspace-session-draft-dialog";
import { useDialogPresence } from "@/components/ui/dialog";
import {
  buildSessionNavigationHref,
  buildSessionsPageHref,
  SESSIONS_PATH,
  SESSIONS_QUERY_KEYS,
  WORKSPACE_SESSION_QUERY_KEYS,
} from "@/features/session-navigation/sessions-route";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { WorkspaceSessionArchiveDialog } from "@/pages/workspace-sessions/workspace-session-archive-dialog";
import { WorkspaceSessionRenameDialog } from "@/pages/workspace-sessions/workspace-session-rename-dialog";
import { useRequiredContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useArchiveWorkspaceSession } from "@openducktor/frontend-core/workspace-sessions/use-archive-workspace-session";
import { readFallbackWorkspaceSessionId } from "@openducktor/frontend-core/queries/workspace-sessions";
import type { SessionNavigationWorkspace } from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";

type SessionMenuTarget =
  | {
      action: "rename" | "archive";
      workspace: SessionNavigationWorkspace;
      record: WorkspaceSession;
      onCloseAutoFocus: (event: Event) => void;
    }
  | {
      action: "discard_draft";
      workspace: SessionNavigationWorkspace;
      draftId: string;
      lifecycle: WorkspaceSessionDraftLifecycle;
      isStarting: boolean;
      onCloseAutoFocus: (event: Event) => void;
    };

type DiscardDraftRequest = {
  workspace: SessionNavigationWorkspace;
  draftId: string;
  lifecycle: WorkspaceSessionDraftLifecycle;
  isStarting: boolean;
  onCloseAutoFocus: (event: Event) => void;
};

type SessionMenuActions = {
  requestDialog: (target: Extract<SessionMenuTarget, { action: "rename" | "archive" }>) => void;
  requestDiscardDraft: (target: DiscardDraftRequest) => void;
  copyToClipboard: (value: string) => Promise<boolean>;
};

const SessionMenuContext = createContext<SessionMenuActions | null>(null);

function matchesWorkspaceSessionRoute(
  pathname: string,
  params: URLSearchParams,
  workspaceId: string,
  key: string,
  value: string,
): boolean {
  return (
    pathname === SESSIONS_PATH &&
    params.get(SESSIONS_QUERY_KEYS.kind) === "workspace" &&
    params.get(SESSIONS_QUERY_KEYS.workspace) === workspaceId &&
    params.get(key) === value
  );
}

function workspaceFallbackHref(
  queryClient: QueryClient,
  workspaceId: string,
  excludeSessionId?: string,
): string {
  const nextSessionId = readFallbackWorkspaceSessionId(queryClient, workspaceId, excludeSessionId);
  return nextSessionId
    ? buildSessionNavigationHref({
        kind: "workspace_session",
        workspaceId,
        sessionId: nextSessionId,
      })
    : buildSessionsPageHref(workspaceId, "workspace");
}

/** Dialogs outlive a row moving between sections or leaving the sidebar after an archive. */
export function SessionMenuProvider({ children }: { children: ReactNode }): ReactElement {
  const connection = useClientConnection();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const routeRef = useRef({ pathname: location.pathname, params });
  useLayoutEffect(() => {
    routeRef.current = { pathname: location.pathname, params };
  }, [location.pathname, params]);
  const [dialog, setDialog] = useState<(SessionMenuTarget & { open: boolean }) | null>(null);
  const mounted = useDialogPresence(dialog?.open === true);
  const request = useCallback(
    (target: Extract<SessionMenuTarget, { action: "rename" | "archive" }>) =>
      setDialog({ ...target, open: true }),
    [],
  );
  const discardNow = useCallback(
    (workspaceId: string, draftId: string) => {
      const { pathname, params: currentParams } = routeRef.current;
      const isViewingDraft = matchesWorkspaceSessionRoute(
        pathname,
        currentParams,
        workspaceId,
        WORKSPACE_SESSION_QUERY_KEYS.draft,
        draftId,
      );
      if (!connection.drafts.newWorkspaceSessions.discard(draftId)) return;
      if (isViewingDraft) {
        void navigate(workspaceFallbackHref(queryClient, workspaceId), { replace: true });
      }
    },
    [connection.drafts.newWorkspaceSessions, navigate, queryClient],
  );
  const requestDiscardDraft = useCallback(
    (target: DiscardDraftRequest) => {
      if (target.isStarting || connection.drafts.newWorkspaceSessions.isStarting(target.draftId)) {
        return;
      }
      if (target.lifecycle === "untouched") {
        discardNow(target.workspace.workspaceId, target.draftId);
        return;
      }
      setDialog({ action: "discard_draft", ...target, open: true });
    },
    [connection.drafts.newWorkspaceSessions, discardNow],
  );
  const close = () => setDialog((current) => current && { ...current, open: false });
  const { copyToClipboard } = useCopyToClipboard();
  const actions = useMemo(
    () => ({ requestDialog: request, requestDiscardDraft, copyToClipboard }),
    [request, requestDiscardDraft, copyToClipboard],
  );
  const dialogKey = dialog
    ? dialog.action === "discard_draft"
      ? `${dialog.action}:${dialog.workspace.workspaceId}:${dialog.draftId}`
      : `${dialog.action}:${dialog.workspace.workspaceId}:${dialog.record.id}`
    : "";
  return (
    <SessionMenuContext value={actions}>
      {children}
      {mounted && dialog && (
        <SessionMenuDialogs
          key={dialogKey}
          dialog={dialog}
          onClose={close}
          onConfirmDiscardDraft={discardNow}
        />
      )}
    </SessionMenuContext>
  );
}

export const useSessionMenu = (): SessionMenuActions =>
  useRequiredContext(SessionMenuContext, "useSessionMenu");

function SessionMenuDialogs({
  dialog,
  onClose,
  onConfirmDiscardDraft,
}: {
  dialog: SessionMenuTarget & { open: boolean };
  onClose: () => void;
  onConfirmDiscardDraft: (workspaceId: string, draftId: string) => void;
}): ReactElement {
  if (dialog.action === "discard_draft") {
    return (
      <DiscardWorkspaceSessionDraftDialog
        open={dialog.open}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        onConfirm={() => onConfirmDiscardDraft(dialog.workspace.workspaceId, dialog.draftId)}
        onCloseAutoFocus={dialog.onCloseAutoFocus}
      />
    );
  }
  return <SavedSessionMenuDialogs dialog={dialog} onClose={onClose} />;
}

function SavedSessionMenuDialogs({
  dialog,
  onClose,
}: {
  dialog: Extract<SessionMenuTarget, { action: "rename" | "archive" }> & { open: boolean };
  onClose: () => void;
}): ReactElement {
  const { record, workspace } = dialog;
  const location = useLocation();
  const [params] = useSearchParams();
  const isSelected = matchesWorkspaceSessionRoute(
    location.pathname,
    params,
    workspace.workspaceId,
    WORKSPACE_SESSION_QUERY_KEYS.session,
    record.id,
  );
  const { run: guardTransition } = useWorkspacePreviewTransitionGuard();
  const archive = useArchiveWorkspaceSession(workspace.workspaceId, record.id);

  if (dialog.action === "rename") {
    return (
      <WorkspaceSessionRenameDialog
        open={dialog.open}
        workspaceId={workspace.workspaceId}
        record={record}
        onClose={onClose}
        onCloseAutoFocus={dialog.onCloseAutoFocus}
      />
    );
  }

  const beginArchive = (
    removeWorktree: boolean,
    worktreeConfirmation?: WorkspaceSessionArchiveInput["worktreeConfirmation"],
  ) => {
    const apply = (draft?: ArchiveFileDraft) => {
      archive.submit(
        {
          workspaceId: workspace.workspaceId,
          repoPath: workspace.repoPath,
          sessionId: record.id,
          confirmStop: true,
          removeWorktree,
          worktreeConfirmation,
        },
        { workspaceLabel: workspace.workspaceName, targetLabel: workspaceSessionTitle(record) },
        draft,
      );
      onClose();
    };
    if (isSelected)
      guardTransition(apply, undefined, { waitForSuccess: true, kind: "archive_chat" });
    else apply();
  };
  return (
    <WorkspaceSessionArchiveDialog
      open={dialog.open}
      workspaceId={workspace.workspaceId}
      record={record}
      isArchiving={archive.isPending}
      onArchive={beginArchive}
      onClose={onClose}
      onCloseAutoFocus={dialog.onCloseAutoFocus}
    />
  );
}
