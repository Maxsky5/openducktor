import { taskHasSessionPage } from "@openducktor/workflows";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import {
  buildSessionsPageHref,
  parseSessionsPageKind,
  SESSIONS_QUERY_KEYS,
  TASK_SESSION_QUERY_KEYS,
} from "@/features/session-navigation/sessions-route";
import { useSessionPanelLayoutPruning } from "@/features/session-panels";
import { SessionViews, useSessionViews } from "./session-views";
import { previewSessionViewId } from "./session-view-resolution";
import { useActiveWorkspace } from "@/state/app-state-provider";
import { useTaskSnapshotContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { SessionsEmptyState } from "./sessions-empty-state";
import {
  isSessionsWorkspaceReady,
  useSessionsWorkspaceMatch,
} from "./use-sessions-workspace-match";

/**
 * One page for task sessions and workspace sessions.
 *
 * The address kind selects the content that owns the rest of the address, so the task and
 * workspace contents never write the same address at the same time.
 */
export function SessionsPage(): ReactElement {
  useSessionPanelLayoutPruning();
  const activeWorkspace = useActiveWorkspace();
  const { tasks } = useTaskSnapshotContext();
  const [searchParams] = useSearchParams();
  const kind = parseSessionsPageKind(searchParams.get(SESSIONS_QUERY_KEYS.kind));
  const sessionViews = useSessionViews({
    workspace: activeWorkspace,
    kind,
    isReady: isSessionsWorkspaceReady(
      searchParams.get(SESSIONS_QUERY_KEYS.workspace),
      activeWorkspace?.workspaceId ?? null,
    ),
  });
  const workspaceMatch = useSessionsWorkspaceMatch(sessionViews.views);
  const previewId =
    workspaceMatch.kind === "pending"
      ? previewSessionViewId(sessionViews.views, `?${searchParams.toString()}`, kind)
      : null;

  if (!activeWorkspace) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-card p-6 text-sm text-muted-foreground">
        No workspace is selected. Select a workspace in the workspace list to see its sessions.
      </div>
    );
  }
  if (kind === "task" && workspaceMatch.kind === "ready") {
    const taskId = searchParams.get(TASK_SESSION_QUERY_KEYS.task);
    if (tasks.some((task) => task.id === taskId && !taskHasSessionPage(task))) {
      return <Navigate to="/kanban" replace />;
    }
  }
  return (
    <>
      {workspaceMatch.kind === "failed" ? (
        <SessionsWorkspaceUnavailable
          message={workspaceMatch.message}
          retry={workspaceMatch.retry}
          activeWorkspaceId={activeWorkspace.workspaceId}
        />
      ) : null}
      {workspaceMatch.kind === "pending" && previewId === null ? (
        <SessionsStatus>Opening workspace…</SessionsStatus>
      ) : null}
      {/* The preview is inert while its workspace opens, so screen readers hear the status. */}
      {workspaceMatch.kind === "pending" && previewId !== null ? (
        <p role="status" className="sr-only">
          Opening workspace…
        </p>
      ) : null}
      {workspaceMatch.kind === "ready" && kind === null ? (
        <SessionsEmptyState key={activeWorkspace.workspaceId} workspace={activeWorkspace} />
      ) : null}
      <SessionViews {...sessionViews} previewId={previewId} />
    </>
  );
}

function SessionsStatus({ children }: { children: string }): ReactElement {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-card p-6">
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        {children}
      </p>
    </div>
  );
}

function SessionsWorkspaceUnavailable({
  message,
  retry,
  activeWorkspaceId,
}: {
  message: string;
  retry: (() => void) | null;
  activeWorkspaceId: string;
}): ReactElement {
  const navigate = useNavigate();
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-card p-6">
      <div
        className="flex max-w-md flex-col gap-3 rounded-lg border border-border bg-card p-5 text-sm"
        role="alert"
      >
        <p className="flex items-center gap-2 font-medium text-foreground">
          <AlertTriangle className="size-4 text-warning-accent" aria-hidden="true" />
          This conversation is unavailable
        </p>
        <p className="text-muted-foreground">{message}</p>
        <div className="flex flex-wrap gap-2">
          {retry ? (
            <Button type="button" size="sm" variant="outline" onClick={retry}>
              Retry
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => navigate(buildSessionsPageHref(activeWorkspaceId, null))}
          >
            Show the current workspace
          </Button>
        </div>
      </div>
    </div>
  );
}
