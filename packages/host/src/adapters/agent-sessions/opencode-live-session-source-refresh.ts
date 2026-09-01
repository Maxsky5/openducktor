import type { OpencodeRuntimeSnapshotSource } from "@openducktor/adapters-opencode-sdk";
import type {
  AgentSessionContextUsage,
  AgentSessionLiveRef,
  AgentSessionLivePendingApprovalRequest,
  AgentSessionLivePendingQuestionRequest,
} from "@openducktor/contracts";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import type { OpenCodeRuntimeInstance } from "./opencode-live-session-normalization";
import type { OpenCodePendingRequestRouter } from "./opencode-pending-request-router";
import {
  openCodeActivityForPending,
  type OpenCodeLiveSnapshotInput,
  type OpenCodeRetainedSession,
  parseOpenCodeLiveSnapshot,
} from "./opencode-live-session-state-policy";

type RefreshOpenCodeRegisteredSourcesInput = {
  runtime: OpenCodeRuntimeInstance;
  refs: ReadonlyArray<AgentSessionLiveRef>;
  sources: ReadonlyArray<OpencodeRuntimeSnapshotSource>;
  contextUsageBySessionId: ReadonlyMap<string, AgentSessionContextUsage>;
  pendingRequests: OpenCodePendingRequestRouter;
  commitSnapshot: (retained: OpenCodeRetainedSession) => AgentSessionLiveAdapterChange[];
  removeSession: (ref: AgentSessionLiveRef) => AgentSessionLiveAdapterChange[];
};

const occurrenceIds = (
  approvals: ReadonlyArray<AgentSessionLivePendingApprovalRequest>,
  questions: ReadonlyArray<AgentSessionLivePendingQuestionRequest>,
): Set<string> =>
  new Set([
    ...approvals.map((request) => request.requestId),
    ...questions.map((request) => request.requestId),
  ]);

export const refreshOpenCodeRegisteredSources = ({
  runtime,
  refs,
  sources,
  contextUsageBySessionId,
  pendingRequests,
  commitSnapshot,
  removeSession,
}: RefreshOpenCodeRegisteredSourcesInput): AgentSessionLiveAdapterChange[] => {
  const changes: AgentSessionLiveAdapterChange[] = [];
  const sourceIds = new Set(sources.map((source) => source.externalSessionId));
  for (const ref of refs) {
    if (!sourceIds.has(ref.externalSessionId)) {
      changes.push(...removeSession(ref));
    }
  }

  for (const source of sources) {
    const ref: AgentSessionLiveRef = {
      repoPath: runtime.repoPath,
      runtimeKind: "opencode",
      workingDirectory: source.workingDirectory,
      externalSessionId: source.externalSessionId,
    };
    const pendingApprovals = source.pendingApprovals.map((request) =>
      pendingRequests.retainApproval(ref, request),
    );
    const pendingQuestions = source.pendingQuestions.map((request) =>
      pendingRequests.retainQuestion(ref, request),
    );
    pendingRequests.removeMissingForSession(ref, occurrenceIds(pendingApprovals, pendingQuestions));
    const snapshotInput: OpenCodeLiveSnapshotInput = {
      ref,
      activity: source.runtimeActivity,
      title: source.title,
      startedAt: source.startedAt,
      pendingApprovals,
      pendingQuestions,
      contextUsage: contextUsageBySessionId.get(source.externalSessionId) ?? null,
    };
    if (source.parentExternalSessionId) {
      snapshotInput.parentExternalSessionId = source.parentExternalSessionId;
    }
    if (source.sessionAssociation.kind === "repository") {
      snapshotInput.repositoryScope = source.sessionAssociation;
    }
    const retained: OpenCodeRetainedSession = {
      runtimeActivity: source.runtimeActivity,
      snapshot: parseOpenCodeLiveSnapshot(
        snapshotInput,
        "opencode-live-session.refresh-registered-source",
      ),
    };
    retained.snapshot = parseOpenCodeLiveSnapshot(
      { ...retained.snapshot, activity: openCodeActivityForPending(retained) },
      "opencode-live-session.refresh-registered-activity",
    );
    changes.push(...commitSnapshot(retained));
  }
  return changes;
};
