import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type {
  AgentPendingInputSource,
  AgentSessionIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import type { RuntimeChildSnapshot } from "./session-read-model/runtime-child-snapshots";

export type PendingInputRoute = {
  shouldPatchParentLink: boolean;
  targets: PendingInputRecordTarget[];
};

export type PendingInputRecordTarget = {
  session: AgentSessionIdentity;
  replySession: AgentSessionIdentity;
  source?: AgentPendingInputSource;
};

type PendingInputProjection = {
  session: AgentSessionState;
  hasProjectedChildPendingInput: boolean;
};

export const normalizePendingInputSessionId = (
  externalSessionId: string | undefined,
): string | null => {
  const trimmed = externalSessionId?.trim();
  return trimmed ? trimmed : null;
};

type PendingInputLink = {
  parentExternalSessionId: string;
  childExternalSessionId: string;
};

const toPendingInputLink = ({
  parentExternalSessionId,
  childExternalSessionId,
}: {
  parentExternalSessionId: string | undefined;
  childExternalSessionId: string | undefined;
}): PendingInputLink | null => {
  const parentId = normalizePendingInputSessionId(parentExternalSessionId);
  const childId = normalizePendingInputSessionId(childExternalSessionId);
  if (!parentId || !childId || parentId === childId) {
    return null;
  }
  return {
    parentExternalSessionId: parentId,
    childExternalSessionId: childId,
  };
};

const hasPendingInput = (snapshot: RuntimeChildSnapshot): boolean =>
  snapshot.pendingApprovals.length > 0 || snapshot.pendingQuestions.length > 0;

const appendPendingInput = <Entry>(current: Entry[], additional: readonly Entry[]): Entry[] => {
  if (additional.length === 0) {
    return current;
  }
  return [...current, ...additional];
};

const toSubagentPendingInputSource = ({
  parentExternalSessionId,
  childExternalSessionId,
  subagentCorrelationKey,
}: {
  parentExternalSessionId: string;
  childExternalSessionId: string;
  subagentCorrelationKey?: string | undefined;
}): AgentPendingInputSource => ({
  kind: "subagent",
  parentExternalSessionId,
  childExternalSessionId,
  ...(subagentCorrelationKey ? { subagentCorrelationKey } : {}),
});

const withSubagentPendingInputSource = <
  Entry extends {
    requestId: string;
    source?: AgentPendingInputSource;
    responseSession?: AgentSessionIdentity;
  },
>(
  entries: readonly Entry[],
  source: AgentPendingInputSource,
  responseSession: AgentSessionIdentity,
): Entry[] =>
  entries.map((entry) => ({
    ...entry,
    source,
    responseSession,
  }));

export const projectRuntimeChildPendingInputToSession = ({
  session,
  runtimeChildSnapshots,
}: {
  session: AgentSessionState;
  runtimeChildSnapshots: readonly RuntimeChildSnapshot[];
}): PendingInputProjection => {
  let pendingApprovals = session.pendingApprovals;
  let pendingQuestions = session.pendingQuestions;
  let hasProjectedChildPendingInput = false;

  for (const snapshot of runtimeChildSnapshots) {
    if (!hasPendingInput(snapshot)) {
      continue;
    }

    const childSession = toAgentSessionIdentity(snapshot.ref);
    const parentExternalSessionId = snapshot.parentExternalSessionId;
    const source = toSubagentPendingInputSource({
      parentExternalSessionId,
      childExternalSessionId: childSession.externalSessionId,
    });
    pendingApprovals = appendPendingInput(
      pendingApprovals,
      withSubagentPendingInputSource(snapshot.pendingApprovals, source, childSession),
    );
    pendingQuestions = appendPendingInput(
      pendingQuestions,
      withSubagentPendingInputSource(snapshot.pendingQuestions, source, childSession),
    );
    hasProjectedChildPendingInput = true;
  }

  if (!hasProjectedChildPendingInput) {
    return { session, hasProjectedChildPendingInput };
  }

  return {
    session: {
      ...session,
      pendingApprovals,
      pendingQuestions,
    },
    hasProjectedChildPendingInput,
  };
};

export const projectPendingInputRoute = ({
  observedSession,
  parentExternalSessionId,
  childExternalSessionId,
  subagentCorrelationKey,
  readSession,
}: {
  observedSession: AgentSessionIdentity;
  parentExternalSessionId: string | undefined;
  childExternalSessionId: string | undefined;
  subagentCorrelationKey?: string | undefined;
  readSession: (externalSessionId: string) => AgentSessionState | null;
}): PendingInputRoute => {
  const link = toPendingInputLink({ parentExternalSessionId, childExternalSessionId });
  if (!link) {
    return {
      shouldPatchParentLink: false,
      targets: [{ session: observedSession, replySession: observedSession }],
    };
  }

  const childSession = readSession(link.childExternalSessionId);
  const parentSession = readSession(link.parentExternalSessionId);
  const observedIsChild = observedSession.externalSessionId === link.childExternalSessionId;
  const observedIsParent = observedSession.externalSessionId === link.parentExternalSessionId;
  const childIdentity = toAgentSessionIdentity(
    childSession ??
      (observedIsChild
        ? observedSession
        : {
            ...observedSession,
            externalSessionId: link.childExternalSessionId,
          }),
  );
  const source = toSubagentPendingInputSource({
    parentExternalSessionId: link.parentExternalSessionId,
    childExternalSessionId: link.childExternalSessionId,
    subagentCorrelationKey,
  });
  const targets = new Map<string, PendingInputRecordTarget>();
  const addTarget = (target: PendingInputRecordTarget): void => {
    targets.set(agentSessionIdentityKey(target.session), target);
  };

  addTarget({
    session: childIdentity,
    replySession: childIdentity,
    source,
  });

  if (parentSession || observedIsParent) {
    const parentIdentity = toAgentSessionIdentity(parentSession ?? observedSession);
    addTarget({
      session: parentIdentity,
      replySession: childIdentity,
      source,
    });
  }

  return {
    shouldPatchParentLink: true,
    targets: Array.from(targets.values()),
  };
};

export const projectResolvedPendingInputSessions = ({
  observedSession,
  parentExternalSessionId,
  externalSessionId,
  childExternalSessionId,
  readSession,
}: {
  observedSession: AgentSessionIdentity;
  parentExternalSessionId: string | undefined;
  externalSessionId: string | undefined;
  childExternalSessionId: string | undefined;
  readSession: (externalSessionId: string) => AgentSessionState | null;
}): AgentSessionState[] => {
  const resolvedSessions = new Map<string, AgentSessionState>();
  const addSession = (session: AgentSessionState | null): void => {
    if (!session) {
      return;
    }
    resolvedSessions.set(agentSessionIdentityKey(session), session);
  };

  const childSessionId = normalizePendingInputSessionId(childExternalSessionId);
  if (childSessionId) {
    addSession(readSession(childSessionId));
  }

  const isLinkedChildForObservedSession =
    childSessionId &&
    parentExternalSessionId === observedSession.externalSessionId &&
    childSessionId !== observedSession.externalSessionId;
  if (isLinkedChildForObservedSession) {
    addSession(readSession(observedSession.externalSessionId));
    return Array.from(resolvedSessions.values());
  }

  if (!childSessionId) {
    const targetSessionId = normalizePendingInputSessionId(externalSessionId);
    if (targetSessionId) {
      addSession(readSession(targetSessionId));
    }
  }

  return Array.from(resolvedSessions.values());
};
