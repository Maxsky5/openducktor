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
import type { OpenCodeRuntimeInstance } from "./opencode-live-session-normalization";
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
} from "./opencode-live-session-state-policy";

type ApplyOpenCodeSessionSourcesInput = {
  runtime: OpenCodeRuntimeInstance;
  sources: ReadonlyArray<OpencodeRuntimeSnapshotSource>;
  failures: ReadonlyArray<OpencodeRuntimeSnapshotFailure>;
  snapshots: ReadonlyArray<AgentSessionLiveSnapshot>;
  contextUsageBySessionId: ReadonlyMap<string, AgentSessionContextUsage>;
  pendingRequests: OpenCodePendingRequestRouter;
  isFresh: (ref: AgentSessionLiveRef) => boolean;
  mergeRecovered: (
    session: OpenCodeLiveSession,
    routes: ReadonlyArray<import("./opencode-pending-request-router").OpenCodePendingRoute>,
  ) => OpenCodeLiveSession | null;
  saveSession: (session: OpenCodeLiveSession) => AgentSessionLiveAdapterChange[];
  removeSession: (ref: AgentSessionLiveRef) => AgentSessionLiveAdapterChange[];
};

type StagedRequest = StagedOpenCodeRequest<
  | AgentSessionLiveSnapshot["pendingApprovals"][number]
  | AgentSessionLiveSnapshot["pendingQuestions"][number]
>;

type StagedSession = {
  readonly session: OpenCodeLiveSession;
  readonly requests: ReadonlyArray<StagedRequest>;
};

export const applyOpenCodeSessionSources = ({
  runtime,
  sources,
  failures,
  snapshots,
  contextUsageBySessionId,
  pendingRequests,
  isFresh,
  mergeRecovered,
  saveSession,
  removeSession,
}: ApplyOpenCodeSessionSourcesInput): AgentSessionLiveAdapterChange[] => {
  const stagedSessions: StagedSession[] = [];
  const seenKeys = new Set<string>();
  for (const source of sources) {
    const ref: AgentSessionLiveRef = {
      repoPath: runtime.repoPath,
      runtimeKind: "opencode",
      workingDirectory: source.workingDirectory,
      externalSessionId: source.externalSessionId,
    };
    seenKeys.add(refKey(ref));
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
      contextUsage:
        source.contextUsage === undefined
          ? (contextUsageBySessionId.get(source.externalSessionId) ?? null)
          : source.contextUsage === null
            ? null
            : toContextUsage(source.contextUsage),
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
    const merged = mergeRecovered(
      {
        ...base,
        snapshot: parseOpenCodeLiveSnapshot(
          { ...base.snapshot, activity: openCodeActivityForPending(base) },
          "opencode-live-session.refresh-activity",
        ),
      },
      [...approvals, ...questions].map((request) => request.route),
    );
    if (merged) stagedSessions.push({ session: merged, requests: [...approvals, ...questions] });
  }

  // A failed root or child-tree read cannot prove that prior descendants vanished.
  const protectedIds = new Set(failures.map((failure) => failure.externalSessionId));
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const snapshot of snapshots) {
      if (
        snapshot.parentExternalSessionId &&
        protectedIds.has(snapshot.parentExternalSessionId) &&
        !protectedIds.has(snapshot.ref.externalSessionId)
      ) {
        protectedIds.add(snapshot.ref.externalSessionId);
        expanded = true;
      }
    }
  }
  const changes: AgentSessionLiveAdapterChange[] = failures.map((failure) => {
    const ref: AgentSessionLiveRef = {
      repoPath: runtime.repoPath,
      runtimeKind: "opencode",
      workingDirectory: failure.workingDirectory,
      externalSessionId: failure.externalSessionId,
    };
    seenKeys.add(refKey(ref));
    return {
      type: "fault",
      repoPath: runtime.repoPath,
      ref,
      operation: "opencode-live-session.refresh-session",
      message: `Failed to refresh OpenCode session '${failure.externalSessionId}' in '${failure.workingDirectory}': ${failure.message}`,
    };
  });
  for (const snapshot of snapshots) {
    if (
      !protectedIds.has(snapshot.ref.externalSessionId) &&
      !seenKeys.has(refKey(snapshot.ref)) &&
      isFresh(snapshot.ref)
    ) {
      changes.push(...removeSession(snapshot.ref));
    }
  }
  for (const staged of stagedSessions) {
    const retainedRequestIds = new Set(
      [
        ...staged.session.snapshot.pendingApprovals,
        ...staged.session.snapshot.pendingQuestions,
      ].map((request) => request.requestId),
    );
    for (const request of staged.requests) {
      if (retainedRequestIds.has(request.route.occurrenceId)) pendingRequests.save(request);
    }
    pendingRequests.removeMissingForSession(staged.session.snapshot.ref, retainedRequestIds);
    changes.push(...saveSession(staged.session));
  }
  return baselineLiveSessionChanges(changes);
};
