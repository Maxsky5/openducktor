import type { WorkspaceSession } from "@openducktor/contracts";
import {
  lazy,
  type PropsWithChildren,
  type ReactElement,
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router";
import {
  type WorkspaceDialogRequest,
  WorkspaceDialogsContext,
} from "@/components/layout/workspace-dialogs-context";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import { returnFocusOnClose } from "@/components/ui/open-dialogs";
import { buildSessionNavigationHref } from "@/features/session-navigation/sessions-route";
import type { ActiveWorkspace } from "@/types/state-slices";

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

/** One owner for the workspace dialogs that the sidebar menu and the command palette open. */
export function WorkspaceDialogsProvider({ children }: PropsWithChildren): ReactElement {
  const navigate = useNavigate();
  const { run: guardTransition } = useWorkspacePreviewTransitionGuard();
  const [dialog, setDialog] = useState<WorkspaceDialogRequest | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const openWorkspaceDialog = useCallback(
    (request: WorkspaceDialogRequest, returnFocus: HTMLElement | null): void => {
      returnFocusRef.current = returnFocus;
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
        onClose={() => setDialog(null)}
        onOpenSession={openSessionAfterSave}
        // Settings can open from an import dialog. Keep focus in that new dialog.
        onCloseAutoFocus={returnFocusOnClose(() => returnFocusRef.current)}
      />
    </WorkspaceDialogsContext>
  );
}

function WorkspaceDialogs({
  dialog,
  onClose,
  onOpenSession,
  onCloseAutoFocus,
}: {
  dialog: WorkspaceDialogRequest | null;
  onClose: () => void;
  onOpenSession: (workspace: ActiveWorkspace, record: WorkspaceSession) => void;
  onCloseAutoFocus: (event: Event) => void;
}): ReactElement {
  return (
    <Suspense fallback={null}>
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
          workspaceId={dialog.workspace.workspaceId}
          repoPath={dialog.workspace.repoPath}
          provider={dialog.provider}
        />
      ) : null}
    </Suspense>
  );
}
