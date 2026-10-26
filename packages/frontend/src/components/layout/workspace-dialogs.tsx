import type { WorkspaceSession } from "@openducktor/contracts";
import {
  createContext,
  lazy,
  type PropsWithChildren,
  type ReactElement,
  Suspense,
  use,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import { useDialogPresence } from "@/components/ui/dialog";
import { buildSessionNavigationHref } from "@/features/session-navigation/sessions-route";
import type { IssueImportProvider } from "@openducktor/frontend-core/tasks/issue-import/issue-import-provider";
import type { ActiveWorkspace } from "@/types/state-slices";

const WorkspaceSessionCreateDialog = lazy(() =>
  import("@/pages/workspace-sessions/workspace-session-create-dialog").then((module) => ({
    default: module.WorkspaceSessionCreateDialog,
  })),
);
const WorkspaceSessionHistoryDialog = lazy(() =>
  import("@/pages/workspace-sessions/workspace-session-history-dialog").then((module) => ({
    default: module.WorkspaceSessionHistoryDialog,
  })),
);
const WorkspaceSessionImportDialog = lazy(() =>
  import("@/pages/workspace-sessions/workspace-session-import-dialog").then((module) => ({
    default: module.WorkspaceSessionImportDialog,
  })),
);
const IssueImportDialog = lazy(() =>
  import("@/pages/kanban/issue-import-dialog").then((module) => ({
    default: module.IssueImportDialog,
  })),
);

/** A dialog keeps the workspace that was active when it opened, so a submission never moves. */
export type WorkspaceDialogRequest =
  | { kind: "chat" | "archived_chats" | "import_chat"; workspace: ActiveWorkspace }
  | { kind: "import_tasks"; workspace: ActiveWorkspace; provider: IssueImportProvider };

type WorkspaceDialogsContextValue = {
  /**
   * Open a workspace dialog. When it closes, focus goes to `returnFocus` unless another dialog
   * took focus.
   */
  openWorkspaceDialog: (request: WorkspaceDialogRequest, returnFocus: HTMLElement | null) => void;
};

/** The create chat dialog stays mounted while it closes, so it keeps its own request. */
type ChatDialogRequest = { workspace: ActiveWorkspace; attempt: number };

const WorkspaceDialogsContext = createContext<WorkspaceDialogsContextValue | null>(null);

export function useWorkspaceDialogs(): WorkspaceDialogsContextValue {
  const value = use(WorkspaceDialogsContext);
  if (!value) throw new Error("useWorkspaceDialogs must be used inside WorkspaceDialogsProvider.");
  return value;
}

/** One owner for the workspace dialogs that the sidebar menu and the command palette open. */
export function WorkspaceDialogsProvider({ children }: PropsWithChildren): ReactElement {
  const navigate = useNavigate();
  const { run: guardTransition } = useWorkspacePreviewTransitionGuard();
  const [dialog, setDialog] = useState<WorkspaceDialogRequest | null>(null);
  const [chatDialog, setChatDialog] = useState<ChatDialogRequest | null>(null);
  const chatAttemptRef = useRef(0);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const openWorkspaceDialog = useCallback(
    (request: WorkspaceDialogRequest, returnFocus: HTMLElement | null): void => {
      returnFocusRef.current = returnFocus;
      if (request.kind === "chat") {
        chatAttemptRef.current += 1;
        setChatDialog({ workspace: request.workspace, attempt: chatAttemptRef.current });
      }
      setDialog(request);
    },
    [],
  );
  // The chat is saved before this runs, so a cancelled transition only skips opening it.
  const openSessionAfterSave = (target: ActiveWorkspace, record: WorkspaceSession): void => {
    setDialog(null);
    const href = buildSessionNavigationHref({
      kind: "workspace_session",
      workspaceId: target.workspaceId,
      sessionId: record.id,
    });
    guardTransition(() => {
      void navigate(href);
    });
  };
  const value = useMemo(() => ({ openWorkspaceDialog }), [openWorkspaceDialog]);

  return (
    <WorkspaceDialogsContext value={value}>
      {children}
      <WorkspaceDialogs
        dialog={dialog}
        chatDialog={chatDialog}
        onClose={() => setDialog(null)}
        onOpenSession={openSessionAfterSave}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // Settings can open from an import dialog. Keep focus in that new dialog.
          if (!document.activeElement?.closest('[role="dialog"][data-state="open"]'))
            returnFocusRef.current?.focus();
        }}
      />
    </WorkspaceDialogsContext>
  );
}

function WorkspaceDialogs({
  dialog,
  chatDialog,
  onClose,
  onOpenSession,
  onCloseAutoFocus,
}: {
  dialog: WorkspaceDialogRequest | null;
  chatDialog: ChatDialogRequest | null;
  onClose: () => void;
  onOpenSession: (workspace: ActiveWorkspace, record: WorkspaceSession) => void;
  onCloseAutoFocus: (event: Event) => void;
}): ReactElement {
  const chatDialogOpen = dialog?.kind === "chat";
  const chatDialogMounted = useDialogPresence(chatDialogOpen);
  return (
    <Suspense fallback={null}>
      {chatDialogMounted && chatDialog ? (
        <WorkspaceSessionCreateDialog
          key={`${chatDialog.workspace.workspaceId}-${chatDialog.attempt}`}
          open={chatDialogOpen}
          workspace={chatDialog.workspace}
          onClose={onClose}
          onCloseAutoFocus={onCloseAutoFocus}
          onCreated={(record) => onOpenSession(chatDialog.workspace, record)}
        />
      ) : null}
      {dialog?.kind === "archived_chats" ? (
        <WorkspaceSessionHistoryDialog
          workspaceId={dialog.workspace.workspaceId}
          repoPath={dialog.workspace.repoPath}
          onClose={onClose}
          onCloseAutoFocus={onCloseAutoFocus}
        />
      ) : null}
      {dialog?.kind === "import_chat" ? (
        <WorkspaceSessionImportDialog
          workspaceId={dialog.workspace.workspaceId}
          onClose={onClose}
          onCloseAutoFocus={onCloseAutoFocus}
          onImported={(record) => onOpenSession(dialog.workspace, record)}
        />
      ) : null}
      {dialog?.kind === "import_tasks" ? (
        <IssueImportDialog
          key={dialog.workspace.workspaceId}
          open
          onCloseAutoFocus={onCloseAutoFocus}
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
          repoPath={dialog.workspace.repoPath}
          provider={dialog.provider}
        />
      ) : null}
    </Suspense>
  );
}
