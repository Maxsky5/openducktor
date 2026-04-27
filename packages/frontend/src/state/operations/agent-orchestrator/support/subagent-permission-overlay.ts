import type { AgentSessionState } from "@/types/agent-orchestrator";

type UpdateSession = (
  sessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

export type SubagentPendingPermissionsBySessionId = NonNullable<
  AgentSessionState["subagentPendingPermissionsBySessionId"]
>;

export const EMPTY_SUBAGENT_PENDING_PERMISSIONS_BY_SESSION_ID = Object.freeze(
  {},
) as SubagentPendingPermissionsBySessionId;

export const mergeSubagentPendingPermissionOverlay = ({
  current,
  scannedChildExternalSessionIds,
  pendingPermissionsByChildExternalSessionId,
}: {
  current: AgentSessionState["subagentPendingPermissionsBySessionId"];
  scannedChildExternalSessionIds: string[];
  pendingPermissionsByChildExternalSessionId: SubagentPendingPermissionsBySessionId;
}): AgentSessionState["subagentPendingPermissionsBySessionId"] => {
  if (
    scannedChildExternalSessionIds.length === 0 &&
    Object.keys(pendingPermissionsByChildExternalSessionId).length === 0
  ) {
    return current;
  }

  const next = { ...(current ?? EMPTY_SUBAGENT_PENDING_PERMISSIONS_BY_SESSION_ID) };
  for (const childExternalSessionId of scannedChildExternalSessionIds) {
    delete next[childExternalSessionId];
  }

  const merged = {
    ...next,
    ...pendingPermissionsByChildExternalSessionId,
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
};

const buildOverlayKeysForSession = (
  sessions: Record<string, AgentSessionState>,
  sessionId: string,
): Set<string> => {
  const targetSession = sessions[sessionId];
  const sessionIds = new Set([sessionId]);
  if (targetSession?.externalSessionId) {
    sessionIds.add(targetSession.externalSessionId);
  }
  return sessionIds;
};

export const clearSubagentPendingPermissionFromSessions = ({
  sessionsRef,
  updateSession,
  targetSessionId,
  requestId,
}: {
  sessionsRef: { current: Record<string, AgentSessionState> };
  updateSession: UpdateSession;
  targetSessionId: string;
  requestId: string;
}): void => {
  const sessionIds = buildOverlayKeysForSession(sessionsRef.current, targetSessionId);

  for (const session of Object.values(sessionsRef.current)) {
    const currentMap = session.subagentPendingPermissionsBySessionId;
    if (!currentMap) {
      continue;
    }

    let changed = false;
    const nextMap = { ...currentMap };
    for (const sessionId of sessionIds) {
      const entries = nextMap[sessionId];
      if (!entries) {
        continue;
      }

      const nextEntries = entries.filter((entry) => entry.requestId !== requestId);
      if (nextEntries.length === entries.length) {
        continue;
      }

      changed = true;
      if (nextEntries.length > 0) {
        nextMap[sessionId] = nextEntries;
      } else {
        delete nextMap[sessionId];
      }
    }

    if (!changed) {
      continue;
    }

    updateSession(
      session.sessionId,
      (current) => ({
        ...current,
        subagentPendingPermissionsBySessionId:
          Object.keys(nextMap).length > 0 ? nextMap : undefined,
      }),
      { persist: false },
    );
  }
};
