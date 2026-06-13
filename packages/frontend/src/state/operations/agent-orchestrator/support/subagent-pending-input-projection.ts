import type { AgentSessionState } from "@/types/agent-orchestrator";

type UpdateSession = (
  externalSessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

type PendingRequestIdsByExternalSessionId = Record<string, string[]>;

const appendRequestId = (
  current: PendingRequestIdsByExternalSessionId | undefined,
  childExternalSessionId: string,
  requestId: string,
): PendingRequestIdsByExternalSessionId => {
  const currentIds = current?.[childExternalSessionId] ?? [];
  if (currentIds.includes(requestId)) {
    return current ?? { [childExternalSessionId]: currentIds };
  }

  return {
    ...(current ?? {}),
    [childExternalSessionId]: [...currentIds, requestId],
  };
};

export const addSubagentPendingApprovalRequestId = (
  current: AgentSessionState["subagentPendingApprovalRequestIdsByExternalSessionId"],
  childExternalSessionId: string,
  requestId: string,
): AgentSessionState["subagentPendingApprovalRequestIdsByExternalSessionId"] =>
  appendRequestId(current, childExternalSessionId, requestId);

export const addSubagentPendingQuestionRequestId = (
  current: AgentSessionState["subagentPendingQuestionRequestIdsByExternalSessionId"],
  childExternalSessionId: string,
  requestId: string,
): AgentSessionState["subagentPendingQuestionRequestIdsByExternalSessionId"] =>
  appendRequestId(current, childExternalSessionId, requestId);

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

const removeRequestIdFromMap = (
  currentMap: PendingRequestIdsByExternalSessionId,
  externalSessionIds: Set<string>,
  requestId: string,
): PendingRequestIdsByExternalSessionId | null => {
  let changed = false;
  const nextMap = { ...currentMap };

  for (const externalSessionId of externalSessionIds) {
    const requestIds = nextMap[externalSessionId];
    if (!requestIds) {
      continue;
    }

    const nextRequestIds = requestIds.filter((entry) => entry !== requestId);
    if (nextRequestIds.length === requestIds.length) {
      continue;
    }

    changed = true;
    if (nextRequestIds.length > 0) {
      nextMap[externalSessionId] = nextRequestIds;
    } else {
      delete nextMap[externalSessionId];
    }
  }

  return changed ? nextMap : null;
};

export const clearSubagentPendingApprovalFromSessions = ({
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
    const currentMap = session.subagentPendingApprovalRequestIdsByExternalSessionId;
    if (!currentMap) {
      continue;
    }

    const nextMap = removeRequestIdFromMap(currentMap, externalSessionIds, requestId);
    if (!nextMap) {
      continue;
    }

    updateSession(
      session.externalSessionId,
      (current) => ({
        ...current,
        subagentPendingApprovalRequestIdsByExternalSessionId:
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
    const currentMap = session.subagentPendingQuestionRequestIdsByExternalSessionId;
    if (!currentMap) {
      continue;
    }

    const nextMap = removeRequestIdFromMap(currentMap, externalSessionIds, requestId);
    if (!nextMap) {
      continue;
    }

    updateSession(
      session.externalSessionId,
      (current) => ({
        ...current,
        subagentPendingQuestionRequestIdsByExternalSessionId:
          Object.keys(nextMap).length > 0 ? nextMap : undefined,
      }),
      { persist: false },
    );
  }
};
