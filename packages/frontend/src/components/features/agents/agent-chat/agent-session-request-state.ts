export type AgentSessionRequestState<Value> = Record<string, Record<string, Value>>;

export const setAgentSessionRequestValue = <Value>(
  source: AgentSessionRequestState<Value>,
  sessionKey: string,
  requestId: string,
  value: Value,
): AgentSessionRequestState<Value> => ({
  ...source,
  [sessionKey]: {
    ...(source[sessionKey] ?? {}),
    [requestId]: value,
  },
});

export const removeAgentSessionRequestValue = <Value>(
  source: AgentSessionRequestState<Value>,
  sessionKey: string,
  requestId: string,
): AgentSessionRequestState<Value> => {
  const sessionRequests = source[sessionKey];
  if (!sessionRequests || !(requestId in sessionRequests)) {
    return source;
  }

  const nextSessionRequests = { ...sessionRequests };
  delete nextSessionRequests[requestId];
  const next = { ...source };
  if (Object.keys(nextSessionRequests).length === 0) {
    delete next[sessionKey];
  } else {
    next[sessionKey] = nextSessionRequests;
  }
  return next;
};

export const selectPendingAgentSessionRequestValues = <Value>(
  source: AgentSessionRequestState<Value>,
  sessionKey: string,
  pendingRequestIds: readonly string[],
): Record<string, Value> => {
  const sessionRequests = source[sessionKey];
  if (!sessionRequests) {
    return {};
  }

  const pendingRequestIdSet = new Set(pendingRequestIds);
  let changed = false;
  const next: Record<string, Value> = {};

  for (const [requestId, value] of Object.entries(sessionRequests)) {
    if (!pendingRequestIdSet.has(requestId)) {
      changed = true;
      continue;
    }
    next[requestId] = value;
  }

  return changed ? next : sessionRequests;
};
