import { memo, type ReactElement, type ReactNode, useLayoutEffect, useState } from "react";
import { useLocation } from "react-router";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { type RepoTaskData, taskQueryKeys } from "@openducktor/frontend-core/queries/tasks";
import { workspaceSessionQueryKeys } from "@openducktor/frontend-core/queries/workspace-sessions";
import type { WorkspaceSession } from "@openducktor/contracts";
import { SessionTerminalHost } from "@/features/session-panels/session-terminal-host";
import { useVisibleSessionView } from "@/features/session-navigation/visible-session-target";
import type { SessionsPageKind } from "@/features/session-navigation/session-navigation-target";
import { SessionViewContext } from "@/features/session-navigation/session-view-context";
import { AgentsPage } from "@/pages/agents/agents-page";
import WorkspaceSessionsPage from "@/pages/workspace-sessions/workspace-sessions-page";
import { useWorkspaceState } from "@/state/app-state-provider";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useSessionViewScope } from "./session-view-scope";
import {
  resolveSessionViews,
  type SessionView as View,
  type SessionViewsState,
} from "./session-view-resolution";

/** Keeps recent session content mounted and selects the view that shows the address. */
export function useSessionViews({
  workspace,
  kind,
  isReady,
}: {
  workspace: ActiveWorkspace | null;
  kind: SessionsPageKind | null;
  isReady: boolean;
}): SessionViewsState {
  const location = useLocation();
  const published = useVisibleSessionView();
  const client = useQueryClient();
  const scope = useSessionViewScope();
  const { workspaces } = useWorkspaceState();
  const [state, setState] = useState<SessionViewsState>({ views: [], activeId: null });
  useLayoutEffect(() => {
    const prune = () =>
      setState((current) => {
        const views = current.views.filter(
          (view) => view.id === current.activeId || hasOwner(client, view),
        );
        return views.length === current.views.length ? current : { ...current, views };
      });
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "success") prune();
    });
    prune();
    return unsubscribe;
  }, [client]);
  const next = resolveSessionViews(state, {
    workspace,
    kind,
    isReady,
    location: { search: location.search, state: location.state },
    published,
    scope,
    isOpen: (candidate) =>
      workspaces.some(
        (open) =>
          open.workspaceId === candidate.workspaceId && open.repoPath === candidate.repoPath,
      ),
    hasOwner: (view) => hasOwner(client, view),
    createId: () => crypto.randomUUID(),
  });
  if (next !== state) setState(next);
  return next;
}

export function SessionViews({ views, activeId }: SessionViewsState): ReactElement {
  return (
    <SessionTerminalHost viewIds={views.map((view) => view.id)}>
      {views
        .toSorted((left, right) => left.id.localeCompare(right.id))
        .map((view) => (
          <SessionView key={view.id} view={view} isActive={view.id === activeId} />
        ))}
    </SessionTerminalHost>
  );
}

const SessionView = memo(function SessionView({
  view,
  isActive,
}: {
  view: View;
  isActive: boolean;
}) {
  const page =
    view.kind === "task" ? (
      <AgentsPage />
    ) : (
      <WorkspaceSessionsPage workspace={view.workspace} isWorkspaceReady />
    );
  return view.scope.reduceRight<ReactNode>(
    (children, bind) => bind(children),
    <SessionViewContext value={{ id: view.id, isActive }}>
      <div
        className="h-full min-h-0"
        style={{ display: isActive ? undefined : "none" }}
        inert={!isActive}
      >
        {page}
      </div>
    </SessionViewContext>,
  );
});

function hasOwner(client: QueryClient, view: View): boolean {
  const params = new URLSearchParams(view.search);
  if (view.kind === "task") {
    const tasks = client.getQueryData<RepoTaskData>(
      taskQueryKeys.repoData(view.workspace.repoPath),
    );
    return (
      tasks === undefined ||
      tasks.tasks.some((task) => task.id === params.get("task") && task.status !== "closed")
    );
  }
  const sessions = client.getQueryData<WorkspaceSession[]>(
    workspaceSessionQueryKeys.list(view.workspace.workspaceId, false),
  );
  return sessions === undefined || sessions.some((session) => session.id === params.get("session"));
}
