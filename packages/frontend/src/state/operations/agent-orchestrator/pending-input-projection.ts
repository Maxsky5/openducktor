import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { RepoRuntimeSessionSnapshots } from "./session-read-model/repo-runtime-session-snapshots";
import type { AgentSessionRuntimeSnapshot } from "./session-read-model/session-runtime-snapshot";

export type PendingInputRoute = {
  shouldPatchParentLink: boolean;
  pendingSession: AgentSessionIdentity | null;
  approvalReplySession: AgentSessionIdentity | null;
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

const sameRuntimeScope = (
  session: AgentSessionState,
  snapshot: AgentSessionRuntimeSnapshot,
): boolean => {
  return (
    snapshot.ref.runtimeKind === session.runtimeKind &&
    normalizeWorkingDirectory(snapshot.ref.workingDirectory) ===
      normalizeWorkingDirectory(session.workingDirectory)
  );
};

const hasPendingInput = (snapshot: AgentSessionRuntimeSnapshot): boolean =>
  snapshot.pendingApprovals.length > 0 || snapshot.pendingQuestions.length > 0;

const shouldProjectChildPendingInput = ({
  session,
  snapshot,
  materializedSessionKeys,
}: {
  session: AgentSessionState;
  snapshot: AgentSessionRuntimeSnapshot;
  materializedSessionKeys: ReadonlySet<string>;
}): boolean => {
  if (
    snapshot.availability !== "runtime" ||
    !snapshot.parentExternalSessionId ||
    snapshot.parentExternalSessionId !== session.externalSessionId ||
    snapshot.ref.externalSessionId === session.externalSessionId ||
    !hasPendingInput(snapshot) ||
    !sameRuntimeScope(session, snapshot)
  ) {
    return false;
  }

  return !materializedSessionKeys.has(agentSessionIdentityKey(snapshot.ref));
};

const appendPendingInput = <Entry>(current: Entry[], additional: readonly Entry[]): Entry[] => {
  if (additional.length === 0) {
    return current;
  }
  return [...current, ...additional];
};

export const projectRuntimeChildPendingInputToSession = ({
  session,
  runtimeSnapshots,
  materializedSessionKeys,
}: {
  session: AgentSessionState;
  runtimeSnapshots: RepoRuntimeSessionSnapshots;
  materializedSessionKeys: ReadonlySet<string>;
}): PendingInputProjection => {
  let pendingApprovals = session.pendingApprovals;
  let pendingQuestions = session.pendingQuestions;
  let hasProjectedChildPendingInput = false;

  for (const snapshot of runtimeSnapshots.values()) {
    if (!shouldProjectChildPendingInput({ session, snapshot, materializedSessionKeys })) {
      continue;
    }

    pendingApprovals = appendPendingInput(pendingApprovals, snapshot.pendingApprovals);
    pendingQuestions = appendPendingInput(pendingQuestions, snapshot.pendingQuestions);
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

const isLinkedChildEvidenceForObservedSession = ({
  observedSession,
  parentExternalSessionId,
  childExternalSessionId,
}: {
  observedSession: AgentSessionIdentity;
  parentExternalSessionId: string | undefined;
  childExternalSessionId: string | null;
}): boolean =>
  Boolean(
    childExternalSessionId &&
      parentExternalSessionId === observedSession.externalSessionId &&
      childExternalSessionId !== observedSession.externalSessionId,
  );

export const projectPendingInputRoute = ({
  observedSession,
  parentExternalSessionId,
  childExternalSessionId,
  readSession,
  isSessionObserved,
}: {
  observedSession: AgentSessionIdentity;
  parentExternalSessionId: string | undefined;
  childExternalSessionId: string | undefined;
  readSession: (externalSessionId: string) => AgentSessionState | null;
  isSessionObserved: (session: AgentSessionIdentity) => boolean;
}): PendingInputRoute => {
  const normalizedChildExternalSessionId = normalizePendingInputSessionId(childExternalSessionId);
  const shouldPatchParentLink = Boolean(
    parentExternalSessionId && normalizedChildExternalSessionId,
  );

  if (
    !isLinkedChildEvidenceForObservedSession({
      observedSession,
      parentExternalSessionId,
      childExternalSessionId: normalizedChildExternalSessionId,
    })
  ) {
    return {
      shouldPatchParentLink,
      pendingSession: observedSession,
      approvalReplySession: observedSession,
    };
  }

  const childSession = normalizedChildExternalSessionId
    ? readSession(normalizedChildExternalSessionId)
    : null;

  if (childSession && isSessionObserved(childSession)) {
    return {
      shouldPatchParentLink,
      pendingSession: null,
      approvalReplySession: null,
    };
  }

  return {
    shouldPatchParentLink,
    pendingSession: childSession,
    approvalReplySession: observedSession,
  };
};

export const projectResolvedPendingInputSession = ({
  externalSessionId,
  childExternalSessionId,
  readSession,
}: {
  externalSessionId: string | undefined;
  childExternalSessionId: string | undefined;
  readSession: (externalSessionId: string) => AgentSessionState | null;
}): AgentSessionState | null => {
  const targetSessionId =
    normalizePendingInputSessionId(childExternalSessionId) ??
    normalizePendingInputSessionId(externalSessionId);
  return targetSessionId ? readSession(targetSessionId) : null;
};
