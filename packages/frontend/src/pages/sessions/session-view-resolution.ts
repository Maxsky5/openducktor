import { MAX_CACHED_TRANSCRIPTS } from "@/components/features/agents/agent-chat/agent-chat-transcript-model-cache";
import {
  buildSessionNavigationSearch,
  sameSessionSelection,
  SESSION_SELECTION_KEYS,
  SESSIONS_QUERY_KEYS,
  TASK_SESSION_QUERY_KEYS,
  WORKSPACE_SESSION_QUERY_KEYS,
  type SessionNavigationTarget,
  type SessionsPageKind,
} from "@/features/session-navigation/session-navigation-target";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { SessionViewScope } from "./session-view-scope";

/** The search and history state of an address. */
export type SessionViewAddress = { search: string; state: unknown };

export type SessionView = SessionViewAddress & {
  id: string;
  kind: SessionsPageKind;
  workspace: ActiveWorkspace;
  scope: SessionViewScope;
};

export type SessionViewsState = { views: SessionView[]; activeId: string | null };

export type SessionViewsInput = {
  workspace: ActiveWorkspace | null;
  kind: SessionsPageKind | null;
  isReady: boolean;
  location: SessionViewAddress;
  /** The target that the content of a view shows. */
  published: { viewId: string | null; target: SessionNavigationTarget } | null;
  scope: SessionViewScope;
  isOpen: (workspace: ActiveWorkspace) => boolean;
  hasOwner: (view: SessionView) => boolean;
  createId: () => string;
};

const ADDRESS_KEYS = [
  SESSIONS_QUERY_KEYS.workspace,
  SESSIONS_QUERY_KEYS.kind,
  ...SESSION_SELECTION_KEYS,
];

/**
 * Selects the views to keep and the view that shows the address. Returns `state` when nothing
 * changes.
 *
 * Two kept views of one workspace and content kind never hold the same selection. Content that
 * resolves a selection of another view leaves it to that view, and its address write then shows
 * that view.
 *
 * `useSessionViews` stores the result during render, so the same input must return the result
 * unchanged. Otherwise React renders without end and stops with error 301.
 */
export function resolveSessionViews(
  state: SessionViewsState,
  input: SessionViewsInput,
): SessionViewsState {
  const isLive = (view: SessionView): boolean =>
    hasSelection(view.search, view.kind) && input.hasOwner(view);
  const open = state.views.filter((view) => input.isOpen(view.workspace));
  const openLive = open.filter(isLive);
  const follow = (view: SessionView): SessionView =>
    followPublished(view, input.published, openLive);
  let views = open.map(follow);
  let activeId: string | null = null;
  const { workspace, kind } = input;
  // The active workspace can resolve to a record that the workspace list no longer has. Its
  // view would leave the kept views on each render, so no view is active until the two agree.
  if (input.isReady && workspace && kind !== null && input.isOpen(workspace)) {
    const view = resolveActiveView(views, state.activeId, input, workspace, kind, follow);
    views = [
      ...views.filter((entry) => entry.id !== view.id && hasSelection(entry.search, entry.kind)),
      view,
    ];
    if (hasSelection(view.search, view.kind)) views = views.slice(-MAX_CACHED_TRANSCRIPTS);
    activeId = view.id;
    // The active view can give up the selection that the published content resolved.
    const live = views.filter(isLive);
    views = views.map((entry) => followPublished(entry, input.published, live));
  }
  views = views.filter((view) => view.id === activeId || isLive(view));
  const changed =
    activeId !== state.activeId ||
    views.length !== state.views.length ||
    views.some((view, index) => view !== state.views[index]);
  return changed ? { views, activeId } : state;
}

/**
 * The address of the last view that the user saw in a workspace and content kind. It keeps the
 * page and selection keys only, so a one-time request such as a notification focus does not
 * repeat.
 */
export function keptSessionViewAddress(
  views: readonly SessionView[],
  workspaceId: string,
  kind: SessionsPageKind,
): SessionViewAddress | null {
  const view = views.findLast(
    (entry) =>
      entry.workspace.workspaceId === workspaceId &&
      entry.kind === kind &&
      hasSelection(entry.search, entry.kind),
  );
  if (!view) return null;
  const params = [...new URLSearchParams(view.search)].filter(([key]) =>
    ADDRESS_KEYS.some((addressKey) => addressKey === key),
  );
  return { search: `?${new URLSearchParams(params).toString()}`, state: view.state };
}

/**
 * The kept view that shows an address while its workspace opens. Its scope keeps the contexts of
 * that workspace, so it can show at once and becomes active when the workspace is active.
 */
export function previewSessionViewId(
  views: readonly SessionView[],
  search: string,
  kind: SessionsPageKind | null,
): string | null {
  if (kind === null || !hasSelection(search, kind)) return null;
  const workspaceId = new URLSearchParams(search).get(SESSIONS_QUERY_KEYS.workspace);
  const view = views.find(
    (entry) =>
      entry.workspace.workspaceId === workspaceId &&
      entry.kind === kind &&
      sameSessionSelection(entry.search, search),
  );
  return view?.id ?? null;
}

/** A selected view can leave before its own URL write reaches the router. */
function followPublished(
  view: SessionView,
  published: SessionViewsInput["published"],
  liveViews: readonly SessionView[],
): SessionView {
  if (published?.viewId !== view.id) return view;
  const { target } = published;
  if (
    target.workspaceId !== view.workspace.workspaceId ||
    (target.kind === "workspace_session") !== (view.kind === "workspace")
  )
    return view;
  const search = buildSessionNavigationSearch(target);
  if (sameSessionSelection(view.search, search)) return view;
  const isHeld = liveViews.some(
    (other) =>
      other.id !== view.id &&
      sameOwner(other, view.workspace, view.kind) &&
      sameSessionSelection(other.search, search),
  );
  return !isHeld &&
    (!hasSelection(view.search, view.kind) || matchesResolvedSelection(view, search, target))
    ? { ...view, search }
    : view;
}

function resolveActiveView(
  views: SessionView[],
  activeId: string | null,
  { location, scope, createId }: SessionViewsInput,
  workspace: ActiveWorkspace,
  kind: SessionsPageKind,
  follow: (view: SessionView) => SessionView,
): SessionView {
  const params = new URLSearchParams(location.search);
  const candidates = views.filter((view) => sameOwner(view, workspace, kind));
  const active = candidates.find((view) => view.id === activeId);
  // A view whose task or chat has gone can still share a selection, so the active view wins.
  const exact = candidates.filter((view) => sameSessionSelection(view.search, location.search));
  const activeAddress = new URLSearchParams(active?.search);
  // The active view stays for an address that names no selection, or less than the view.
  const keepsActive =
    exact.length === 0 &&
    active !== undefined &&
    (!hasSelection(location.search, kind) || fitsAddress(active, params));
  // The active view takes an address that adds to an empty selection or to a task without a session.
  const growsActive =
    exact.length === 0 &&
    active !== undefined &&
    (!hasSelection(active.search, kind) ||
      (activeAddress.get(TASK_SESSION_QUERY_KEYS.task) ===
        params.get(TASK_SESSION_QUERY_KEYS.task) &&
        !activeAddress.has(TASK_SESSION_QUERY_KEYS.session)));
  const previous =
    (active && exact.includes(active) ? active : exact[0]) ??
    (keepsActive || growsActive ? active : undefined) ??
    // An address without a session goes back to the last view of its task.
    (params.has(TASK_SESSION_QUERY_KEYS.session)
      ? undefined
      : candidates.findLast(
          (view) =>
            new URLSearchParams(view.search).get(TASK_SESSION_QUERY_KEYS.task) ===
            params.get(TASK_SESSION_QUERY_KEYS.task),
        ));
  // The view takes the address. `followPublished` then adds what the content shows past it.
  const view = follow({
    id: previous?.id ?? createId(),
    search: location.search,
    state: location.state,
    kind,
    workspace,
    scope,
  });
  return previous && sameView(previous, view) ? previous : view;
}

function sameView(left: SessionView, right: SessionView): boolean {
  return (
    left.search === right.search &&
    left.state === right.state &&
    left.workspace === right.workspace &&
    left.scope.every((binding, index) => binding === right.scope[index])
  );
}

function sameOwner(view: SessionView, workspace: ActiveWorkspace, kind: SessionsPageKind): boolean {
  return (
    view.workspace.workspaceId === workspace.workspaceId &&
    view.workspace.repoPath === workspace.repoPath &&
    view.kind === kind
  );
}

/** The address names no part of the selection that differs from the view. */
function fitsAddress(view: SessionView, params: URLSearchParams): boolean {
  const address = new URLSearchParams(view.search);
  return SESSION_SELECTION_KEYS.every(
    (key) => !params.has(key) || params.get(key) === address.get(key),
  );
}

function hasSelection(search: string, kind: SessionsPageKind): boolean {
  return new URLSearchParams(search).has(
    kind === "task" ? TASK_SESSION_QUERY_KEYS.task : WORKSPACE_SESSION_QUERY_KEYS.session,
  );
}

/** Either address can stay partial until the resolved session's URL write commits. */
function matchesResolvedSelection(
  view: SessionView,
  search: string,
  target: SessionNavigationTarget,
): boolean {
  if (
    view.kind !== "task" ||
    target.kind !== "task_session" ||
    target.workspaceId !== view.workspace.workspaceId
  )
    return false;
  const resolved = new URLSearchParams(buildSessionNavigationSearch(target));
  return [view.search, search].every((address) => {
    const params = new URLSearchParams(address);
    return (
      params.get(TASK_SESSION_QUERY_KEYS.task) === target.taskId &&
      [TASK_SESSION_QUERY_KEYS.session, TASK_SESSION_QUERY_KEYS.agent].every(
        (key) => !params.has(key) || params.get(key) === resolved.get(key),
      )
    );
  });
}
