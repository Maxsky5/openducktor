import { memo, type ReactElement, type ReactNode, useLayoutEffect, useState } from "react";
import { useLocation } from "react-router";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { type RepoTaskData, taskQueryKeys } from "@openducktor/frontend-core/queries/tasks";
import { workspaceSessionQueryKeys } from "@openducktor/frontend-core/queries/workspace-sessions";
import type { WorkspaceSession } from "@openducktor/contracts";
import { MAX_CACHED_TRANSCRIPTS } from "@/components/features/agents/agent-chat/agent-chat-transcript-model-cache";
import { SessionTerminalHost } from "@/features/session-panels/session-terminal-host";
import { useVisibleSessionView } from "@/features/session-navigation/visible-session-target";
import {
  buildSessionNavigationHref,
  SESSIONS_PATH,
  type SessionNavigationTarget,
} from "@/features/session-navigation/session-navigation-target";
import { SessionViewContext } from "@/features/session-navigation/session-view-context";
import { AgentsPage } from "@/pages/agents/agents-page";
import WorkspaceSessionsPage from "@/pages/workspace-sessions/workspace-sessions-page";
import { useWorkspaceState } from "@/state/app-state-provider";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useSessionViewScope, type SessionViewScope } from "./session-view-scope";

type View = {
  id: string;
  search: string;
  kind: "task" | "workspace";
  workspace: ActiveWorkspace;
  scope: SessionViewScope;
};

export function SessionViews({
  workspace,
  kind,
  isReady,
}: {
  workspace: ActiveWorkspace;
  kind: "task" | "workspace" | null;
  isReady: boolean;
}): ReactElement {
  const location = useLocation();
  const published = useVisibleSessionView();
  const visible = published?.target ?? null;
  const client = useQueryClient();
  const scope = useSessionViewScope();
  const { workspaces } = useWorkspaceState();
  const params = new URLSearchParams(location.search);
  const isOpen = (candidate: ActiveWorkspace): boolean =>
    workspaces.some(
      (open) => open.workspaceId === candidate.workspaceId && open.repoPath === candidate.repoPath,
    );
  const [state, setState] = useState<{ views: View[]; activeId: string | null }>({
    views: [],
    activeId: null,
  });
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
  // A selected view can leave before its own URL write reaches the router.
  let views = state.views
    .map((view) => {
      if (published?.viewId !== view.id) return view;
      const search = selectionSearch(published.target);
      if (sameSelection(view.search, search)) return view;
      return !hasSelection(view) || matchesResolvedSelection(view, search, published.target)
        ? { ...view, search }
        : view;
    })
    .filter((view) => isOpen(view.workspace));
  let activeId: string | null = null;
  // The active workspace can resolve to a record that the workspace list no longer has. Its
  // view would leave the kept views on each render, so no view is active until the two agree.
  if (isReady && kind !== null && isOpen(workspace)) {
    const candidates = views.filter(
      (view) =>
        view.workspace.workspaceId === workspace.workspaceId &&
        view.workspace.repoPath === workspace.repoPath &&
        view.kind === kind,
    );
    const previous =
      candidates.find((view) => sameSelection(view.search, location.search)) ??
      candidates.find(
        (view) =>
          view.id === state.activeId && matchesResolvedSelection(view, location.search, visible),
      ) ??
      candidates.findLast(
        (view) =>
          new URLSearchParams(view.search).get("task") === params.get("task") &&
          (!params.has("session") ||
            (view.id === state.activeId && !new URLSearchParams(view.search).has("session"))),
      );
    const view: View =
      previous &&
      previous.scope.every((binding, index) => binding === scope[index]) &&
      previous.id === state.activeId
        ? previous
        : {
            id: previous?.id ?? crypto.randomUUID(),
            search: location.search,
            kind,
            workspace,
            scope,
          };
    views = [...views.filter((entry) => entry.id !== view.id && hasSelection(entry)), view];
    if (hasSelection(view)) views = views.slice(-MAX_CACHED_TRANSCRIPTS);
    activeId = view.id;
  }
  views = views.filter(
    (view) => view.id === activeId || (hasSelection(view) && hasOwner(client, view)),
  );
  if (
    activeId !== state.activeId ||
    views.length !== state.views.length ||
    views.some((view, index) => view !== state.views[index])
  ) {
    setState({ views, activeId });
  }
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

function sameSelection(left: string, right: string): boolean {
  const a = new URLSearchParams(left);
  const b = new URLSearchParams(right);
  return ["task", "session", "agent", "runtimeKind", "workingDirectory"].every(
    (key) => a.get(key) === b.get(key),
  );
}

function hasSelection(view: View): boolean {
  return new URLSearchParams(view.search).has(view.kind === "task" ? "task" : "session");
}

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

/** Either address can stay partial until the resolved session's URL write commits. */
function matchesResolvedSelection(
  view: View,
  search: string,
  target: SessionNavigationTarget | null,
): boolean {
  if (
    view.kind !== "task" ||
    target?.kind !== "task_session" ||
    target.workspaceId !== view.workspace.workspaceId
  )
    return false;
  const resolved = new URLSearchParams(selectionSearch(target));
  return [view.search, search].every((address) => {
    const params = new URLSearchParams(address);
    return (
      params.get("task") === target.taskId &&
      ["session", "agent", "runtimeKind", "workingDirectory"].every(
        (key) => !params.has(key) || params.get(key) === resolved.get(key),
      )
    );
  });
}

function selectionSearch(target: SessionNavigationTarget): string {
  return buildSessionNavigationHref(target).slice(SESSIONS_PATH.length);
}
