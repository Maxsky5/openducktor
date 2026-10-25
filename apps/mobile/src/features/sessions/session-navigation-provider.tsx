import { useWatchSessionBlockers } from "@openducktor/frontend-core/sessions/navigation/session-read-state";
import {
  type SessionGrouping,
  useSessionGrouping,
} from "@openducktor/frontend-core/sessions/navigation/use-session-grouping";
import {
  type SessionNavigationModelResult,
  useSessionNavigationModel,
} from "@openducktor/frontend-core/sessions/navigation/use-session-navigation-model";
import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  use,
  useDeferredValue,
  useMemo,
} from "react";
import { useMobileWorkspaces } from "@/composition/workspace-selection";
import { usePublishNeedsYouCount } from "./needs-you-count";
import { sessionsNeedsYouCount } from "./session-list-model";

/** The desktop session list scope: the selected workspace, or every open workspace. */
export type SessionScope = "current" | "all";

export type SessionNavigation = SessionNavigationModelResult & {
  /**
   * The workspace list that built the model. A screen that reads the model reads these too, so
   * an empty model of a list that has not loaded never shows as a list with no sessions.
   */
  workspacesLoading: boolean;
  workspaceCount: number;
};

const SessionNavigationContext = createContext<SessionNavigation | null>(null);
const SessionGroupingContext = createContext<SessionGrouping | null>(null);

/**
 * The session model of every open workspace, built once for the Sessions list and the Needs you
 * badge. The list of the selected workspace filters it, so a scope switch builds nothing again.
 * It wraps the Sessions stack only, so React looks for its readers there and not in the other
 * tabs; the badge reads its count from `NeedsYouCountProvider`. The Sessions tab stays mounted
 * for the whole connection, so the provider also keeps the blocked-task read marks current, as
 * the always-visible desktop sidebar does.
 */
export function SessionNavigationProvider({ children }: PropsWithChildren): ReactElement {
  const { workspaces, isLoading: workspacesLoading } = useMobileWorkspaces();
  const grouping = useSessionGrouping();
  // The grouping switch shows a change at once. The model that it groups builds again with the
  // list, at background priority.
  const listGrouping = useDeferredValue(grouping.grouping);
  const { model, retrySource, refresh } = useSessionNavigationModel(workspaces, listGrouping);
  useWatchSessionBlockers(model);
  const workspaceCount = workspaces.length;
  const value = useMemo(
    () => ({ model, retrySource, refresh, workspacesLoading, workspaceCount }),
    [model, refresh, retrySource, workspaceCount, workspacesLoading],
  );
  // A live change renders the list and the badge at background priority. React splits the list
  // render around touches and frames, so the screen in front stays smooth and the list stays
  // current under it, also during a swipe back.
  const shown = useDeferredValue(value);
  usePublishNeedsYouCount(sessionsNeedsYouCount(shown.model));
  return (
    <SessionGroupingContext value={grouping}>
      <SessionNavigationContext value={shown}>{children}</SessionNavigationContext>
    </SessionGroupingContext>
  );
}

/** The grouping switch of the session list (see `SessionNavigationProvider`). */
export const useSessionListGrouping = (): SessionGrouping => {
  const value = use(SessionGroupingContext);
  if (!value) throw new Error("useSessionListGrouping must be used inside the Sessions stack.");
  return value;
};

/** The session model of every open workspace (see `SessionNavigationProvider`). */
export const useAllSessionNavigation = (): SessionNavigation => {
  const value = use(SessionNavigationContext);
  if (!value) throw new Error("useAllSessionNavigation must be used inside the Sessions stack.");
  return value;
};
