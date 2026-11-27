import { taskHasSessionPage } from "@openducktor/workflows";
import {
  memo,
  type ReactElement,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import type { NewWorkspaceSessionDraftStore } from "@openducktor/frontend-core/drafts/new-workspace-session-draft-store";
import { type RepoTaskData, taskQueryKeys } from "@openducktor/frontend-core/queries/tasks";
import { workspaceSessionQueryKeys } from "@openducktor/frontend-core/queries/workspace-sessions";
import type { WorkspaceSession } from "@openducktor/contracts";
import { SessionTerminalHost } from "@/features/session-panels/session-terminal-host";
import {
  useVisibleSessionControls,
  useVisibleSessionView,
  type VisibleSession,
} from "@openducktor/frontend-core/sessions/navigation/visible-session-target";
import {
  buildSessionNavigationSearch,
  sameSessionSelection,
  WORKSPACE_SESSION_QUERY_KEYS,
  type SessionsPageKind,
} from "@/features/session-navigation/sessions-route";
import {
  SessionViewContext,
  SessionViewShownContext,
} from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import { AgentsPage } from "@/pages/agents/shell/agents-page";
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
  const draftStore = useClientConnection().drafts.newWorkspaceSessions;
  const scope = useSessionViewScope();
  const { workspaces } = useWorkspaceState();
  const [state, setState] = useState<SessionViewsState>({ views: [], activeId: null });
  // Keep one pending view ID across StrictMode render replays so a new view never commits under two keys.
  const [pendingId, setPendingId] = useState<string>(() => crypto.randomUUID());
  useLayoutEffect(() => {
    const prune = () =>
      setState((current) => {
        const views = current.views.filter(
          (view) => view.id === current.activeId || hasOwner(client, draftStore, view),
        );
        return views.length === current.views.length ? current : { ...current, views };
      });
    const unsubscribeQuery = client.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "success") prune();
    });
    const unsubscribeDrafts = draftStore.subscribe(prune);
    prune();
    return () => {
      unsubscribeQuery();
      unsubscribeDrafts();
    };
  }, [client, draftStore]);
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
    hasOwner: (view) => hasOwner(client, draftStore, view),
    createId: () => pendingId,
  });
  if (next !== state) {
    setState(next);
    if (next.views.some((view) => view.id === pendingId)) {
      setPendingId(crypto.randomUUID());
    }
  }
  return next;
}

/** A preview view shows while its workspace opens, and it stays inactive until then. */
export function SessionViews({
  views,
  activeId,
  previewId = null,
}: SessionViewsState & { previewId?: string | null }): ReactElement {
  const { publish, hideView } = useVisibleSessionControls();
  const visible = useVisibleSessionView();
  const shown = views.find((view) => view.id === (activeId ?? previewId));
  const shownId = shown?.id ?? null;
  const readShownView = useEffectEvent(() => shown ?? null);
  // The target that each kept view last published.
  const lastPublished = useRef(new Map<string, VisibleSession>());
  useLayoutEffect(() => {
    if (visible?.viewId) lastPublished.current.set(visible.viewId, visible);
  }, [visible]);
  useEffect(() => {
    const ids = new Set(views.map((view) => view.id));
    for (const id of lastPublished.current.keys()) {
      if (!ids.has(id)) lastPublished.current.delete(id);
    }
  }, [views]);
  // The session list marks a kept view in the paint that shows it, before its content turns
  // active and publishes again. A view that leaves the screen clears its mark, also when its
  // content never turned active.
  useLayoutEffect(() => {
    if (shownId === null) return;
    const currentShown = readShownView();
    const shownSearch = currentShown?.search ?? "";
    const last = lastPublished.current.get(shownId);
    // Only active content marks its session as read, so the mark carries no read key.
    if (last && sameSessionSelection(buildSessionNavigationSearch(last.target), shownSearch)) {
      publish({ ...last, readKey: null });
    } else if (currentShown?.kind === "workspace") {
      const draftId = new URLSearchParams(shownSearch).get(WORKSPACE_SESSION_QUERY_KEYS.draft);
      if (draftId) {
        publish({
          target: {
            kind: "workspace_session_draft",
            workspaceId: currentShown.workspace.workspaceId,
            draftId,
          },
          readKey: null,
          viewId: shownId,
        });
      }
    }
    return () => hideView(shownId);
  }, [hideView, publish, shownId]);
  return (
    <SessionTerminalHost viewIds={views.map((view) => view.id)}>
      {views
        .toSorted((left, right) => left.id.localeCompare(right.id))
        .map((view) => (
          <SessionView
            key={view.id}
            view={view}
            isActive={view.id === activeId}
            isShown={view.id === activeId || view.id === previewId}
          />
        ))}
    </SessionTerminalHost>
  );
}

const SessionView = memo(function SessionView({
  view,
  isActive,
  isShown,
}: {
  view: View;
  isActive: boolean;
  isShown: boolean;
}) {
  // A new view, or a view that was on screen before it turned active, such as a preview, has no
  // paint to wait for. Its content turns active at once. Other content keeps its activity and
  // address scope until the switch paints.
  const [isContentActive, setIsContentActive] = useState(isActive);
  const [contentView, setContentView] = useState(view);
  const [last, setLast] = useState({ isActive, isShown });
  if (last.isActive !== isActive || last.isShown !== isShown) {
    if (isActive && !last.isActive && last.isShown && isShown) setIsContentActive(true);
    setLast({ isActive, isShown });
  }
  if (isContentActive === isActive && contentView !== view) setContentView(view);
  useEffect(() => {
    if (isContentActive === isActive) return;
    // The frame callbacks of the old and new views run before the next paint. React renders
    // their updates together after that paint, at default priority, so the render goes before
    // transitions, does not yield, and a stream update cannot hold it back.
    const frame = requestAnimationFrame(() => setIsContentActive(isActive));
    return () => cancelAnimationFrame(frame);
  }, [isActive, isContentActive]);
  // Each consumer in the view renders again when this value changes, so keep it stable.
  const context = useMemo(
    () => ({ id: view.id, isActive: isContentActive }),
    [view.id, isContentActive],
  );
  const page =
    contentView.kind === "task" ? (
      <AgentsPage />
    ) : (
      <WorkspaceSessionsPage workspace={contentView.workspace} isWorkspaceReady />
    );
  return contentView.scope.reduceRight<ReactNode>(
    (children, bind) => bind(children),
    <SessionViewContext value={context}>
      <SessionViewShownContext value={isShown}>
        <div
          className="h-full min-h-0"
          style={{ display: isShown ? undefined : "none" }}
          // Content that is not active yet takes no input.
          inert={!isActive || !isContentActive}
        >
          {page}
        </div>
      </SessionViewShownContext>
    </SessionViewContext>,
  );
});

function hasOwner(
  client: QueryClient,
  draftStore: NewWorkspaceSessionDraftStore,
  view: View,
): boolean {
  const params = new URLSearchParams(view.search);
  if (view.kind === "task") {
    const tasks = client.getQueryData<RepoTaskData>(taskQueryKeys.repoData(view.workspace));
    return (
      tasks === undefined ||
      tasks.tasks.some((task) => task.id === params.get("task") && taskHasSessionPage(task))
    );
  }
  const draftId = params.get(WORKSPACE_SESSION_QUERY_KEYS.draft);
  if (draftId !== null) {
    const draft = draftStore.getDraft(draftId);
    return draft !== null && draft.workspaceId === view.workspace.workspaceId;
  }
  const sessions = client.getQueryData<WorkspaceSession[]>(
    workspaceSessionQueryKeys.list(view.workspace.workspaceId, false),
  );
  return sessions === undefined || sessions.some((session) => session.id === params.get("session"));
}
