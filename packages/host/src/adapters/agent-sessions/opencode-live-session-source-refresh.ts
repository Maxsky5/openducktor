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
import { refKey } from "./opencode-live-session-normalization";
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
      });
      continue;
    }
    const approvals = source.pendingApprovals.map((request) =>
      pendingRequests.stageApproval(ref, request),
    );
    const questions = source.pendingQuestions.map((request) =>
      pendingRequests.stageQuestion(ref, request),
    );
    const snapshotInput: OpenCodeLiveSnapshotInput = {
      ref,
      activity: source.runtimeActivity,
      title: source.title,
      startedAt: source.startedAt,
      pendingApprovals: approvals.map(({ request }) => request),
      pendingQuestions: questions.map(({ request }) => request),
      contextUsage: contextUsageBySessionId.get(source.externalSessionId) ?? null,
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
    });
  }

  const changes: AgentSessionLiveAdapterChange[] = [];
  for (const failure of failures) {
    const ref: AgentSessionLiveRef = {
      repoPath: failure.repoPath,
      runtimeKind: "opencode",
      workingDirectory: failure.workingDirectory,
      externalSessionId: failure.externalSessionId,
    };
    seenKeys.add(refKey(ref));
    const message = `Failed to refresh OpenCode session '${failure.externalSessionId}' in '${failure.workingDirectory}': ${failure.message}`;
    // The previous snapshot stays for the conversation, but its status is not current. Skip
    // the mark when another update confirmed the status during the read.
    const current = sessions.get(refKey(ref));
    if (current && readScope(ref) !== "none") {
      changes.push(...commitSnapshot(withStatusUnavailable(current, message)));
    }
    changes.push({
      type: "fault",
      repoPath: failure.repoPath,
      ref,
      operation: "opencode-live-session.refresh-session",
      message,
      statusUnavailable: true,
    });
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
  for (const { session, requests } of stagedSessions) {
    if (requests) {
      for (const request of requests) {
        pendingRequests.save(request);
      }
      pendingRequests.removeMissingForSession(
        session.snapshot.ref,
        new Set(requests.map(({ route }) => route.occurrenceId)),
      );
    }
    changes.push(...commitStatus(session));
  }
  return baselineLiveSessionChanges(changes);
};
