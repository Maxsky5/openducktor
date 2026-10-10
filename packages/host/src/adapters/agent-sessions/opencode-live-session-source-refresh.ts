import { agentSessionTranscriptEventSchema } from "@openducktor/contracts";
import { baselineLiveSessionChanges } from "../../application/agent-sessions/baseline-live-session-changes";
import type {
  OpencodeRuntimeSnapshotFailure,
  OpencodeRuntimeSnapshotSource,
} from "@openducktor/adapters-opencode-sdk";
import type {
  AgentSessionContextUsage,
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import { refKey, toContextUsage } from "./opencode-live-session-normalization";
import type {
  OpenCodePendingRequestRouter,
  StagedOpenCodeRequest,
} from "./opencode-pending-request-router";
import {
  openCodeActivityForPending,
  type OpenCodeLiveSnapshotInput,
  type OpenCodeLiveSession,
  parseOpenCodeLiveSnapshot,
  requireOpenCodeLiveSession,
  withReadStatus,
  withStatusUnavailable,
} from "./opencode-live-session-state-policy";
import type { OpenCodeReadScope } from "./opencode-live-session-versions";

type ApplyOpenCodeSessionSourcesInput = {
  /** The refreshed repository. Snapshots of other repositories stay unchanged. */
  repoPath: string;
  runtimeId: string;
  sources: ReadonlyArray<OpencodeRuntimeSnapshotSource>;
  failures: ReadonlyArray<OpencodeRuntimeSnapshotFailure>;
  sessions: ReadonlyMap<string, OpenCodeLiveSession>;
  contextUsageBySessionId: ReadonlyMap<string, AgentSessionContextUsage>;
  pendingRequests: OpenCodePendingRequestRouter;
  readScope: (ref: AgentSessionLiveRef) => OpenCodeReadScope;
  /** Saves a status that the read confirmed, so an older read in progress cannot replace it. */
  commitStatus: (session: OpenCodeLiveSession) => AgentSessionLiveAdapterChange[];
  commitSnapshot: (session: OpenCodeLiveSession) => AgentSessionLiveAdapterChange[];
  removeSession: (ref: AgentSessionLiveRef) => AgentSessionLiveAdapterChange[];
};

type StagedRequest = StagedOpenCodeRequest<
  | AgentSessionLiveSnapshot["pendingApprovals"][number]
  | AgentSessionLiveSnapshot["pendingQuestions"][number]
>;

type StagedSession = {
  readonly session: OpenCodeLiveSession;
  /** The pending input of the read, or null when the read sets only the status. */
  readonly requests: ReadonlyArray<StagedRequest> | null;
  readonly queuedMessages: ReadonlyArray<AgentSessionLiveAdapterChange>;
};

export const applyOpenCodeSessionSources = ({
  repoPath,
  runtimeId,
  sources,
  failures,
  sessions,
  contextUsageBySessionId,
  pendingRequests,
  readScope,
  commitStatus,
  commitSnapshot,
  removeSession,
}: ApplyOpenCodeSessionSourcesInput): AgentSessionLiveAdapterChange[] => {
  const stagedSessions: StagedSession[] = [];
  const seenKeys = new Set<string>();
  for (const source of sources) {
    const ref: AgentSessionLiveRef = {
      repoPath: source.repoPath,
      runtimeKind: "opencode",
      workingDirectory: source.workingDirectory,
      externalSessionId: source.externalSessionId,
    };
    seenKeys.add(refKey(ref));
    const scope = readScope(ref);
    if (scope === "none") {
      continue;
    }
    if (scope === "status") {
      const current = requireOpenCodeLiveSession(sessions, runtimeId, ref);
      stagedSessions.push({
        session: withReadStatus(current, source.runtimeActivity),
        requests: null,
        queuedMessages: [],
      });
      continue;
    }
    const approvals = source.pendingApprovals.map((request) =>
      pendingRequests.stageApproval(ref, request),
    );
    const questions = source.pendingQuestions.map((request) =>
      pendingRequests.stageQuestion(ref, request),
    );
    let contextUsage = contextUsageBySessionId.get(source.externalSessionId) ?? null;
    if (source.contextUsage !== undefined)
      contextUsage = source.contextUsage === null ? null : toContextUsage(source.contextUsage);
    const snapshotInput: OpenCodeLiveSnapshotInput = {
      ref,
      activity: source.runtimeActivity,
      title: source.title,
      startedAt: source.startedAt,
      pendingApprovals: approvals.map(({ request }) => request),
      pendingQuestions: questions.map(({ request }) => request),
      contextUsage,
    };
    if (source.parentExternalSessionId) {
      snapshotInput.parentExternalSessionId = source.parentExternalSessionId;
    }
    if (source.sessionAssociation.kind === "repository") {
      snapshotInput.repositoryScope = source.sessionAssociation;
    }
    const base: OpenCodeLiveSession = {
      runtimeActivity: source.runtimeActivity,
      snapshot: parseOpenCodeLiveSnapshot(snapshotInput, "opencode-live-session.refresh-source"),
    };
    if (source.sessionAssociation.kind !== "unbound") base.sessionScope = source.sessionAssociation;
    stagedSessions.push({
      session: {
        ...base,
        snapshot: parseOpenCodeLiveSnapshot(
          { ...base.snapshot, activity: openCodeActivityForPending(base) },
          "opencode-live-session.refresh-activity",
        ),
      },
      requests: [...approvals, ...questions],
      queuedMessages: (source.queuedMessages ?? []).map((event) => ({
        type: "transcript_event",
        event: agentSessionTranscriptEventSchema.parse({ ...event, sessionRef: ref }),
      })),
    });
  }

  const changes: AgentSessionLiveAdapterChange[] = [];
  const childrenByParent = new Map<string, AgentSessionLiveRef[]>();
  for (const { snapshot } of sessions.values()) {
    if (snapshot.ref.repoPath !== repoPath || !snapshot.parentExternalSessionId) continue;
    const parentKey = refKey({
      ...snapshot.ref,
      externalSessionId: snapshot.parentExternalSessionId,
    });
    const children = childrenByParent.get(parentKey) ?? [];
    children.push(snapshot.ref);
    childrenByParent.set(parentKey, children);
  }
  for (const failure of failures) {
    const ref: AgentSessionLiveRef = {
      repoPath: failure.repoPath,
      runtimeKind: "opencode",
      workingDirectory: failure.workingDirectory,
      externalSessionId: failure.externalSessionId,
    };
    const failureKey = refKey(ref);
    const message = `Failed to refresh OpenCode session '${failure.externalSessionId}' in '${failure.workingDirectory}': ${failure.message}`;
    // A failed ancestor leaves unread descendants unknown. Keep their snapshots and pending
    // input. A source or live status confirmed during the read still takes priority.
    const unreadRefs = [ref];
    const visited = new Set<string>();
    for (const unreadRef of unreadRefs) {
      const key = refKey(unreadRef);
      if (visited.has(key)) continue;
      visited.add(key);
      unreadRefs.push(...(childrenByParent.get(key) ?? []));
      if (key !== failureKey && seenKeys.has(key)) continue;
      seenKeys.add(key);
      const current = sessions.get(key);
      if (current && readScope(unreadRef) !== "none") {
        changes.push(...commitSnapshot(withStatusUnavailable(current, message)));
      }
    }
    const change = {
      type: "fault" as const,
      repoPath: failure.repoPath,
      ref,
      operation: "opencode-live-session.refresh-session",
      message,
      statusUnavailable: true as const,
    };
    changes.push(
      failure.runtimeOperationFailure
        ? { ...change, runtimeOperationFailure: failure.runtimeOperationFailure }
        : change,
    );
  }
  const missingSessions = [...sessions.values()].filter(
    ({ snapshot }) =>
      snapshot.ref.repoPath === repoPath &&
      !seenKeys.has(refKey(snapshot.ref)) &&
      readScope(snapshot.ref) === "session",
  );
  for (const { snapshot } of missingSessions) {
    changes.push(...removeSession(snapshot.ref));
  }
  for (const { session, requests, queuedMessages } of stagedSessions) {
    if (requests) {
      for (const request of requests) {
        pendingRequests.save(request);
      }
      pendingRequests.removeMissingForSession(
        session.snapshot.ref,
        new Set(requests.map(({ route }) => route.occurrenceId)),
      );
    }
    changes.push(...commitStatus(session), ...queuedMessages);
  }
  return baselineLiveSessionChanges(changes);
};
