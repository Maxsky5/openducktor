import type { AgentSessionState } from "@/types/agent-orchestrator";

type UpdateSession = (
  externalSessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

export type SubagentPendingPermissionsByExternalSessionId = NonNullable<
  AgentSessionState["subagentPendingPermissionsByExternalSessionId"]
>;

export const EMPTY_SUBAGENT_PENDING_PERMISSIONS_BY_EXTERNAL_SESSION_ID = Object.freeze(
  {},
) as SubagentPendingPermissionsByExternalSessionId;

export const mergeSubagentPendingPermissionOverlay = ({
  current,
  scannedChildExternalSessionIds,
  pendingPermissionsByChildExternalSessionId,
}: {
  current: AgentSessionState["subagentPendingPermissionsByExternalSessionId"];
  scannedChildExternalSessionIds: string[];
  pendingPermissionsByChildExternalSessionId: SubagentPendingPermissionsByExternalSessionId;
}): AgentSessionState["subagentPendingPermissionsByExternalSessionId"] => {
  if (
    scannedChildExternalSessionIds.length === 0 &&
    Object.keys(pendingPermissionsByChildExternalSessionId).length === 0
  ) {
    return current;
  }

  const next = { ...(current ?? EMPTY_SUBAGENT_PENDING_PERMISSIONS_BY_EXTERNAL_SESSION_ID) };
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
  externalSessionId: string,
): Set<string> => {
  const targetSession = sessions[externalSessionId];
  const externalSessionIds = new Set([externalSessionId]);
  if (targetSession?.externalSessionId) {
    externalSessionIds.add(targetSession.externalSessionId);
  }
  return externalSessionIds;
};

export const clearSubagentPendingPermissionFromSessions = ({
  sessionsRef,
  updateSession,
  targetExternalSessionId,
  requestId,
}: {
  sessionsRef: { current: Record<string, AgentSessionState> };
  updateSession: UpdateSession;
  targetExternalSessionId: string;
  requestId: string;
}): void => {
  const externalSessionIds = buildOverlayKeysForSession(
    sessionsRef.current,
    targetExternalSessionId,
  );

  for (const session of Object.values(sessionsRef.current)) {
    const currentMap = session.subagentPendingPermissionsByExternalSessionId;
    if (!currentMap) {
      continue;
    }

    let changed = false;
    const nextMap = { ...currentMap };
    for (const externalSessionId of externalSessionIds) {
      const entries = nextMap[externalSessionId];
      if (!entries) {
        continue;
      }

      const nextEntries = entries.filter((entry) => entry.requestId !== requestId);
      if (nextEntries.length === entries.length) {
        continue;
      }

      changed = true;
      if (nextEntries.length > 0) {
        nextMap[externalSessionId] = nextEntries;
      } else {
        delete nextMap[externalSessionId];
      }
    }

    if (!changed) {
      continue;
    }

    updateSession(
      session.externalSessionId,
      (current) => ({
        ...current,
        subagentPendingPermissionsByExternalSessionId:
          Object.keys(nextMap).length > 0 ? nextMap : undefined,
      }),
      { persist: false },
    );
  }
};
