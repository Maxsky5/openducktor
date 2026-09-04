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
} from "./opencode-live-session-state-policy";

type ApplyOpenCodeSessionSourcesInput = {
  runtime: OpenCodeRuntimeInstance;
  sources: ReadonlyArray<OpencodeRuntimeSnapshotSource>;
  failures: ReadonlyArray<OpencodeRuntimeSnapshotFailure>;
  snapshots: ReadonlyArray<AgentSessionLiveSnapshot>;
  contextUsageBySessionId: ReadonlyMap<string, AgentSessionContextUsage>;
  pendingRequests: OpenCodePendingRequestRouter;
  isFresh: (ref: AgentSessionLiveRef) => boolean;
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
    if (!isFresh(ref)) {
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
    if (!seenKeys.has(refKey(snapshot.ref)) && isFresh(snapshot.ref)) {
      changes.push(...removeSession(snapshot.ref));
    }
  }
  for (const staged of stagedSessions) {
    for (const request of staged.requests) {
      pendingRequests.save(request);
    }
    pendingRequests.removeMissingForSession(
      staged.session.snapshot.ref,
      new Set(staged.requests.map(({ route }) => route.occurrenceId)),
    );
    changes.push(...saveSession(staged.session));
  }
  return changes;
};
