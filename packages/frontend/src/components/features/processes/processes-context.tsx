import type { WorkspaceProcessList } from "@openducktor/contracts";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  workspaceProcessQueryKeys,
  workspaceProcessesQueryOptions,
} from "@openducktor/frontend-core/queries/workspace-processes";
import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  memo,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router";
import { toast } from "sonner";
import { useLocalHost } from "@/components/layout/host-connection";
import type { FloatingWindowRect } from "@/components/ui/floating-window";
import { useOpenExternalUrl } from "@/lib/open-external-url";
import { useWorkspaceScope } from "@/state/app-state-provider";

/** Closed, open as a flyout beside the rail, or detached as a window that floats over the app. */
type ProcessesView = "closed" | "flyout" | "floating";

/** The task whose checkout comes first in the list. */
type ProcessesFocus = { workspaceId: string; taskId: string };

/**
 * What a reader can do with the Processes view, and the facts that change only with the workspace
 * or the host. The value stays the same while the view opens, closes, or moves, so a ports button or a
 * command that only opens the view does not render again.
 */
export type ProcessesActions = {
  activeWorkspaceId: string | null;
  /** The rail button and the shortcut open and close the view. */
  toggleProcesses(): void;
  closeProcesses(): void;
  /** Turns the flyout into a floating window at the same place. */
  detach(rect: FloatingWindowRect): void;
  /** Turns the floating window back into the flyout of the rail. */
  attach(): void;
  openUrl(url: string): void;
};

/** How the view shows now. */
export type ProcessesViewState = {
  view: ProcessesView;
  focus: ProcessesFocus | null;
};

/** The place and size of the floating window, kept while the app runs. */
type FloatingPlacement = {
  rect: FloatingWindowRect;
  setRect(rect: FloatingWindowRect): void;
};

/** The element that holds the list, so its popovers stay inside it for focus and clicks. */
export const PROCESSES_SURFACE = "[data-processes-surface]";

/** Processes change without host events. The open view reads them again this often. */
export const LIVE_REFRESH_MS = 2_000;

/**
 * The rail badge and the ports buttons read them this often while the view is closed. A command that
 * the user stops leaves the badge within this time.
 */
const AMBIENT_REFRESH_MS = 5_000;

const AGENT_STUDIO_PATH = "/sessions";

/** A window that opens without a flyout to start from sits beside the rail, near the bottom. */
const defaultFloatingRect = (): FloatingWindowRect => {
  const width = 576;
  const height = Math.min(480, window.innerHeight - 96);
  return { x: 88, y: Math.max(8, window.innerHeight - height - 56), width, height };
};

// A remote host has no Processes view, so its actions are null.
const ActionsContext = createContext<ProcessesActions | null>(null);
const ViewStateContext = createContext<ProcessesViewState>({ view: "closed", focus: null });
const PlacementContext = createContext<FloatingPlacement | null>(null);

/** The task that Agent Studio shows, from its address. */
function useAgentStudioTaskId(): string | null {
  const location = useLocation();
  if (location.pathname !== AGENT_STUDIO_PATH) return null;
  return new URLSearchParams(location.search).get("task");
}

/**
 * Owns the Processes view: the flyout of the rail, the floating window, and the one live read that
 * every reader shares. The read runs often only while the view is open. Readers take the actions,
 * the view state, and the window placement from separate contexts, so each one renders again only
 * for its own part.
 */
export function ProcessesProvider({ children }: PropsWithChildren): ReactElement {
  const localHost = useLocalHost();
  const hostClient = useHostClient();
  const openExternalUrl = useOpenExternalUrl();
  const { activeWorkspace } = useWorkspaceScope();
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const studioTaskId = useAgentStudioTaskId();
  const available = localHost !== null;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"flyout" | "floating">("flyout");
  const [floatingRect, setFloatingRect] = useState(defaultFloatingRect);
  const view: ProcessesView = open ? mode : "closed";
  const focus = useMemo(
    () =>
      studioTaskId && activeWorkspaceId
        ? { workspaceId: activeWorkspaceId, taskId: studioTaskId }
        : null,
    [studioTaskId, activeWorkspaceId],
  );

  const closeProcesses = useCallback(() => {
    setOpen(false);
  }, []);
  const toggleProcesses = useCallback(() => {
    if (!available) return;
    setOpen((current) => !current);
  }, [available]);
  const detach = useCallback((rect: FloatingWindowRect) => {
    setFloatingRect(rect);
    setMode("floating");
    setOpen(true);
  }, []);
  const attach = useCallback(() => {
    setMode("flyout");
    setOpen(true);
  }, []);
  const openUrl = useCallback(
    (url: string) => {
      void (async () => {
        try {
          // The web runner asks its host for the system browser, so a failure has a reason.
          if (localHost === "web") await hostClient.openExternalUrl(url);
          else await openExternalUrl(url);
        } catch (error) {
          toast.error(`Could not open ${url}`, { description: errorMessage(error) });
        }
      })();
    },
    [hostClient, localHost, openExternalUrl],
  );
  const actions = useMemo(
    (): ProcessesActions | null =>
      available
        ? {
            activeWorkspaceId,
            toggleProcesses,
            closeProcesses,
            detach,
            attach,
            openUrl,
          }
        : null,
    [available, activeWorkspaceId, toggleProcesses, closeProcesses, detach, attach, openUrl],
  );
  const viewState = useMemo(() => ({ view, focus }), [view, focus]);
  const placement = useMemo(
    () => ({ rect: floatingRect, setRect: setFloatingRect }),
    [floatingRect],
  );
  return (
    <ActionsContext value={actions}>
      <ViewStateContext value={viewState}>
        <PlacementContext value={placement}>
          {available ? <LiveProcessRead open={view !== "closed"} /> : null}
          {children}
        </PlacementContext>
      </ViewStateContext>
    </ActionsContext>
  );
}

/**
 * The one read that refreshes the shared list. Other readers only watch the cache. The open view
 * reads while the app shows. The badge and the ports buttons read only while the app has the focus, and
 * the query reads again at once when the focus comes back.
 */
const LiveProcessRead = memo(function LiveProcessRead({ open }: { open: boolean }): null {
  const { refetch } = useQuery({
    ...workspaceProcessesQueryOptions(),
    refetchInterval: () => {
      if (open) return LIVE_REFRESH_MS;
      return document.hasFocus() ? AMBIENT_REFRESH_MS : false;
    },
  });
  // The query refreshes when the page shows again, not when a visible window gets the focus back.
  useEffect(() => {
    const onFocus = () => void refetch();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetch]);
  useRefreshWhenWorkspacesClose();
  return null;
});

/** A closed workspace leaves the list at once, and the list reads the processes again. */
function useRefreshWhenWorkspacesClose(): void {
  const queryClient = useQueryClient();
  const { workspaces } = useWorkspaceScope();
  const ids = useMemo(() => new Set(workspaces.map((entry) => entry.workspaceId)), [workspaces]);
  const previous = useRef(ids);
  useEffect(() => {
    const closed = [...previous.current].some((id) => !ids.has(id));
    previous.current = ids;
    if (closed) void queryClient.invalidateQueries({ queryKey: workspaceProcessQueryKeys.all });
  }, [ids, queryClient]);
}

/**
 * The shared list of all open workspaces, without a read of its own. `select` keeps a reader
 * from rendering again when its part of the list stays the same.
 */
export function useProcessList<T>(select: (list: WorkspaceProcessList) => T): UseQueryResult<T> {
  // The options keep the read, because the query takes the options of its last reader.
  return useQuery({ ...workspaceProcessesQueryOptions(), enabled: false, select });
}

/** The actions of the Processes view, or null for a remote host and outside the app shell. */
export function useProcessesActions(): ProcessesActions | null {
  return use(ActionsContext);
}

/** How the Processes view shows now. Closed for a remote host and outside the app shell. */
export function useProcessesViewState(): ProcessesViewState {
  return use(ViewStateContext);
}

/** The place and size of the floating window. Only the window reads it. */
export function useFloatingPlacement(): FloatingPlacement | null {
  return use(PlacementContext);
}
