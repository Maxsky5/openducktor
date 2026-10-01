import type { WorkspaceSession, WorkspaceSessionArchiveInput } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import { useDialogPresence } from "@/components/ui/dialog";
import {
  buildSessionNavigationHref,
  buildSessionsPageHref,
  SESSIONS_PATH,
  SESSIONS_QUERY_KEYS,
  WORKSPACE_SESSION_QUERY_KEYS,
} from "@/features/session-navigation/session-navigation-target";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { WorkspaceSessionArchiveDialog } from "@/pages/workspace-sessions/workspace-session-archive-dialog";
import { WorkspaceSessionRenameDialog } from "@/pages/workspace-sessions/workspace-session-rename-dialog";
import { useMountedRef } from "@/pages/workspace-sessions/use-mounted-ref";
import { useRequiredContext } from "@/state/app-state-contexts";
import { useArchiveWorkspaceSession } from "@/state/operations/use-archive-workspace-session";
import { workspaceSessionQueryKeys } from "@/state/queries/workspace-sessions";
import type { SessionNavigationWorkspace } from "@/state/read-models/session-navigation-read-model";

type SessionMenuTarget = {
  action: "rename" | "archive";
  workspace: SessionNavigationWorkspace;
  record: WorkspaceSession;
  onCloseAutoFocus: (event: Event) => void;
};

type SessionMenuActions = {
  requestDialog: (target: SessionMenuTarget) => void;
  copyToClipboard: (value: string) => Promise<boolean>;
};

const SessionMenuContext = createContext<SessionMenuActions | null>(null);

/** Dialogs outlive a row moving between sections or leaving the sidebar after an archive. */
export function SessionMenuProvider({ children }: { children: ReactNode }): ReactElement {
  const [dialog, setDialog] = useState<(SessionMenuTarget & { open: boolean }) | null>(null);
  const mounted = useDialogPresence(dialog?.open === true);
  const request = useCallback(
    (target: SessionMenuTarget) => setDialog({ ...target, open: true }),
    [],
  );
  const close = () => setDialog((current) => current && { ...current, open: false });
  const { copyToClipboard } = useCopyToClipboard();
  const actions = useMemo(
    () => ({ requestDialog: request, copyToClipboard }),
    [request, copyToClipboard],
  );
  return (
    <SessionMenuContext value={actions}>
      {children}
      {mounted && dialog && (
        <SessionMenuDialogs
          key={`${dialog.action}:${dialog.workspace.workspaceId}:${dialog.record.id}`}
          dialog={dialog}
          onClose={close}
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
}: {
  dialog: SessionMenuTarget & { open: boolean };
  onClose: () => void;
}): ReactElement {
  const { record, workspace } = dialog;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  // The archive event clears the visible session before the command returns.
  const isSelected =
    location.pathname === SESSIONS_PATH &&
    params.get(SESSIONS_QUERY_KEYS.kind) === "workspace" &&
    params.get(SESSIONS_QUERY_KEYS.workspace) === workspace.workspaceId &&
    params.get(WORKSPACE_SESSION_QUERY_KEYS.session) === record.id;
  const mounted = useMountedRef();
  const { run: guardTransition } = useWorkspacePreviewTransitionGuard();
  const archive = useArchiveWorkspaceSession((archived, input) => {
    if (!mounted.current) return;
    if (isSelected) {
      const remaining = queryClient.getQueryData<WorkspaceSession[]>(
        workspaceSessionQueryKeys.list(input.workspaceId, false),
      );
      const next = remaining?.find((session) => session.id !== archived.id);
      void navigate(
        next
          ? buildSessionNavigationHref({
              kind: "workspace_session",
              workspaceId: input.workspaceId,
              sessionId: next.id,
            })
          : buildSessionsPageHref(input.workspaceId, "workspace"),
        { replace: true },
      );
    }
    onClose();
  });

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
    const apply = async () => {
      archive.reset();
      try {
        await archive.mutateAsync({
          workspaceId: workspace.workspaceId,
          repoPath: workspace.repoPath,
          sessionId: record.id,
          confirmStop: true,
          removeWorktree,
          worktreeConfirmation,
        });
        return true;
      } catch {
        return false;
      }
    };
    if (isSelected) {
      guardTransition(apply, undefined, { waitForSuccess: true });
    } else void apply();
  };
  return (
    <WorkspaceSessionArchiveDialog
      open={dialog.open}
      workspaceId={workspace.workspaceId}
      record={record}
      isArchiving={archive.isPending}
      error={archive.error}
      onArchive={beginArchive}
      onClose={onClose}
      onCloseAutoFocus={dialog.onCloseAutoFocus}
    />
  );
}
