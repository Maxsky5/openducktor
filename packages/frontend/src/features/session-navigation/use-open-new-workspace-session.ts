import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { useVisibleSessionControls } from "@openducktor/frontend-core/sessions/navigation/visible-session-target";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import { buildWorkspaceSessionDraftHref } from "./sessions-route";

type OpenNewWorkspaceSessionOptions = {
  /** Set false when the caller already ran the workspace transition guard. */
  guard?: boolean;
};

/**
 * Opens an immediate new workspace session draft page for the given workspace.
 * Reuses the current untouched draft when already viewing one in the same workspace.
 */
export function useOpenNewWorkspaceSession(): (
  workspaceId: string,
  options?: OpenNewWorkspaceSessionOptions,
) => void {
  const connection = useClientConnection();
  const navigate = useNavigate();
  const { run: guardTransition } = useWorkspacePreviewTransitionGuard();
  const { readVisible } = useVisibleSessionControls();

  return useCallback(
    (workspaceId: string, options?: OpenNewWorkspaceSessionOptions) => {
      const visible = readVisible();
      const activeDraftId =
        visible?.target.kind === "workspace_session_draft" &&
        visible.target.workspaceId === workspaceId
          ? visible.target.draftId
          : null;
      const draft = connection.drafts.newWorkspaceSessions.ensureDraftForNewSession(
        workspaceId,
        activeDraftId,
      );
      if (activeDraftId === draft.id) {
        document.querySelector<HTMLElement>("[data-composer-editor]")?.focus();
        return;
      }
      const href = buildWorkspaceSessionDraftHref(workspaceId, draft.id);
      if (options?.guard === false) {
        void navigate(href);
        return;
      }
      guardTransition(() => {
        void navigate(href);
      });
    },
    [connection.drafts.newWorkspaceSessions, guardTransition, navigate, readVisible],
  );
}
