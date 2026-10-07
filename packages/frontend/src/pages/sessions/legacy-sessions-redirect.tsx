import type { ReactElement } from "react";
import { Navigate, useLocation } from "react-router";
import {
  legacySessionsSearch,
  SESSIONS_PATH,
  type SessionsPageKind,
} from "@/features/session-navigation/session-navigation-target";

/**
 * Send an old task workflow or chat address to the Sessions page.
 *
 * The query, hash, and route state stay, so saved links and notifications still open their
 * task, role, session, creation, or attention target.
 */
export function LegacySessionsRedirect({ kind }: { kind: SessionsPageKind }): ReactElement {
  const location = useLocation();
  return (
    <Navigate
      to={{
        pathname: SESSIONS_PATH,
        search: legacySessionsSearch(location.search, kind),
        hash: location.hash,
      }}
      state={location.state}
      replace
    />
  );
}
