import type { AgentSessionState } from "@/types/agent-orchestrator";

type UpdateSession = (
  externalSessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

export type SubagentPendingPermissionsByExternalSessionId = NonNullable<
  AgentSessionState["subagentPendingPermissionsByExternalSessionId"]
>;

export type SubagentPendingQuestionsByExternalSessionId = NonNullable<
  AgentSessionState["subagentPendingQuestionsByExternalSessionId"]
>;

export const EMPTY_SUBAGENT_PENDING_PERMISSIONS_BY_EXTERNAL_SESSION_ID = Object.freeze(
  {},
) as SubagentPendingPermissionsByExternalSessionId;

export const EMPTY_SUBAGENT_PENDING_QUESTIONS_BY_EXTERNAL_SESSION_ID = Object.freeze(
  {},
) as SubagentPendingQuestionsByExternalSessionId;

const mergePendingRequestsByRequestId = <T extends { requestId: string }>(
  currentEntries: T[] | undefined,
  hydratedEntries: T[] | undefined,
): T[] | undefined => {
  const mergedByRequestId = new Map<string, T>();
  for (const entry of currentEntries ?? []) {
    mergedByRequestId.set(entry.requestId, entry);
  }
  for (const entry of hydratedEntries ?? []) {
    if (!mergedByRequestId.has(entry.requestId)) {
      mergedByRequestId.set(entry.requestId, entry);
    }
  }

  return mergedByRequestId.size > 0 ? Array.from(mergedByRequestId.values()) : undefined;
};

const mergeSubagentPendingOverlayByChildExternalSessionId = <T extends { requestId: string }>(
  current: Record<string, T[]> | undefined,
  scannedChildExternalSessionIds: string[],
  hydratedByChildExternalSessionId: Record<string, T[]>,
): Record<string, T[]> | undefined => {
  const next = { ...(current ?? {}) };
  const childExternalSessionIds = new Set([
    ...Object.keys(next),
    ...Object.keys(hydratedByChildExternalSessionId),
    ...scannedChildExternalSessionIds,
  ]);

  for (const childExternalSessionId of childExternalSessionIds) {
    const mergedEntries = mergePendingRequestsByRequestId(
      next[childExternalSessionId],
      hydratedByChildExternalSessionId[childExternalSessionId],
    );
    if (mergedEntries) {
      next[childExternalSessionId] = mergedEntries;
      continue;
    }
    delete next[childExternalSessionId];
  }

  return Object.keys(next).length > 0 ? next : undefined;
};

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

  return mergeSubagentPendingOverlayByChildExternalSessionId(
    current,
    scannedChildExternalSessionIds,
    pendingPermissionsByChildExternalSessionId,
  );
};

export const mergeSubagentPendingQuestionOverlay = ({
  current,
  scannedChildExternalSessionIds,
  pendingQuestionsByChildExternalSessionId,
}: {
  current: AgentSessionState["subagentPendingQuestionsByExternalSessionId"];
  scannedChildExternalSessionIds: string[];
  pendingQuestionsByChildExternalSessionId: SubagentPendingQuestionsByExternalSessionId;
}): AgentSessionState["subagentPendingQuestionsByExternalSessionId"] => {
  if (
    scannedChildExternalSessionIds.length === 0 &&
    Object.keys(pendingQuestionsByChildExternalSessionId).length === 0
  ) {
    return current;
  }

  return mergeSubagentPendingOverlayByChildExternalSessionId(
    current,
    scannedChildExternalSessionIds,
    pendingQuestionsByChildExternalSessionId,
  );
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

export const clearSubagentPendingQuestionFromSessions = ({
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
    const currentMap = session.subagentPendingQuestionsByExternalSessionId;
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
        subagentPendingQuestionsByExternalSessionId:
          Object.keys(nextMap).length > 0 ? nextMap : undefined,
      }),
      { persist: false },
    );
  }
};
