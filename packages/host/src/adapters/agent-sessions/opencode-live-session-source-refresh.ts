import type { OpencodeRegisteredRuntimeRefreshResult } from "@openducktor/adapters-opencode-sdk";
import type {
  AgentSessionContextUsage,
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import type { OpenCodeRuntimeInstance } from "./opencode-live-session-normalization";
import { refKey, toSessionRef } from "./opencode-live-session-normalization";
import type {
  OpenCodePendingRequestRouter,
  PreparedOpenCodePendingRequest,
} from "./opencode-pending-request-router";
import {
  openCodeActivityForPending,
  type OpenCodeLiveSnapshotInput,
  type OpenCodeRetainedSession,
  parseOpenCodeLiveSnapshot,
} from "./opencode-live-session-state-policy";

type RefreshOpenCodeRegisteredSourcesInput = {
  runtime: OpenCodeRuntimeInstance;
  results: ReadonlyArray<OpencodeRegisteredRuntimeRefreshResult>;
  previousRegisteredRoots: ReadonlyArray<AgentSessionLiveRef>;
  retainedSnapshots: ReadonlyArray<AgentSessionLiveSnapshot>;
  contextUsageBySessionId: ReadonlyMap<string, AgentSessionContextUsage>;
  pendingRequests: OpenCodePendingRequestRouter;
  commitSnapshot: (retained: OpenCodeRetainedSession) => AgentSessionLiveAdapterChange[];
  removeSession: (ref: AgentSessionLiveRef) => AgentSessionLiveAdapterChange[];
};

type AnyPreparedRequest = PreparedOpenCodePendingRequest<
  | AgentSessionLiveSnapshot["pendingApprovals"][number]
  | AgentSessionLiveSnapshot["pendingQuestions"][number]
>;

type PreparedSource = {
  readonly retained: OpenCodeRetainedSession;
  readonly pending: ReadonlyArray<AnyPreparedRequest>;
};

const isDescendantOf = (
  snapshot: AgentSessionLiveSnapshot,
  root: AgentSessionLiveRef,
  snapshotsByRef: ReadonlyMap<string, AgentSessionLiveSnapshot>,
): boolean => {
  let parentId = snapshot.parentExternalSessionId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    if (parentId === root.externalSessionId) {
      return true;
    }
    visited.add(parentId);
    parentId = snapshotsByRef.get(
      refKey({ ...toSessionRef(snapshot.ref), externalSessionId: parentId }),
    )?.parentExternalSessionId;
  }
  return false;
};

export const refreshOpenCodeRegisteredSources = ({
  runtime,
  results,
  previousRegisteredRoots,
  retainedSnapshots,
  contextUsageBySessionId,
  pendingRequests,
  commitSnapshot,
  removeSession,
}: RefreshOpenCodeRegisteredSourcesInput): AgentSessionLiveAdapterChange[] => {
  const snapshotsByRef = new Map(
    retainedSnapshots.map((snapshot) => [refKey(snapshot.ref), snapshot]),
  );
  const refsToRemove: AgentSessionLiveRef[] = [];
  const preparedSources: PreparedSource[] = [];
  const nextRegisteredRootKeys = new Set(results.map(({ ref }) => refKey(ref)));
  for (const ref of previousRegisteredRoots) {
    if (!nextRegisteredRootKeys.has(refKey(ref))) {
      refsToRemove.push(ref);
    }
  }

  for (const result of results) {
    if (result.ref.repoPath !== runtime.repoPath || result.ref.runtimeKind !== "opencode") {
      throw new HostValidationError({
        field: "registeredSessionRef",
        message: `OpenCode runtime '${runtime.runtimeId}' cannot refresh session '${result.ref.externalSessionId}' from repo '${result.ref.repoPath}' and runtime '${result.ref.runtimeKind}'.`,
        details: { runtimeId: runtime.runtimeId, ref: result.ref },
      });
    }
    if (result.type === "missing") {
      refsToRemove.push(result.ref);
      continue;
    }
    const rootSource = result.sources.find(
      (source) =>
        source.externalSessionId === result.ref.externalSessionId &&
        source.workingDirectory === result.ref.workingDirectory &&
        source.parentExternalSessionId === undefined,
    );
    if (!rootSource) {
      throw new HostValidationError({
        field: "registeredSessionRef",
        message: `OpenCode did not return registered session '${result.ref.externalSessionId}' in '${result.ref.workingDirectory}'.`,
        details: { runtimeId: runtime.runtimeId, ref: result.ref },
      });
    }

    const sourceRefKeys = new Set(
      result.sources.map((source) =>
        refKey({
          repoPath: runtime.repoPath,
          runtimeKind: "opencode",
          workingDirectory: source.workingDirectory,
          externalSessionId: source.externalSessionId,
        }),
      ),
    );
    for (const snapshot of retainedSnapshots) {
      if (
        isDescendantOf(snapshot, result.ref, snapshotsByRef) &&
        !sourceRefKeys.has(refKey(snapshot.ref))
      ) {
        refsToRemove.push(snapshot.ref);
      }
    }

    for (const source of result.sources) {
      const ref: AgentSessionLiveRef = {
        repoPath: runtime.repoPath,
        runtimeKind: "opencode",
        workingDirectory: source.workingDirectory,
        externalSessionId: source.externalSessionId,
      };
      const preparedApprovals = source.pendingApprovals.map((request) =>
        pendingRequests.prepareApproval(ref, request),
      );
      const preparedQuestions = source.pendingQuestions.map((request) =>
        pendingRequests.prepareQuestion(ref, request),
      );
      const snapshotInput: OpenCodeLiveSnapshotInput = {
        ref,
        activity: source.runtimeActivity,
        title: source.title,
        startedAt: source.startedAt,
        pendingApprovals: preparedApprovals.map(({ request }) => request),
        pendingQuestions: preparedQuestions.map(({ request }) => request),
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
      preparedSources.push({
        retained,
        pending: [...preparedApprovals, ...preparedQuestions],
      });
    }
  }

  const changes: AgentSessionLiveAdapterChange[] = [];
  for (const ref of refsToRemove) {
    changes.push(...removeSession(ref));
  }
  for (const prepared of preparedSources) {
    for (const request of prepared.pending) {
      pendingRequests.commitPrepared(request);
    }
    pendingRequests.removeMissingForSession(
      prepared.retained.snapshot.ref,
      new Set(prepared.pending.map(({ route }) => route.occurrenceId)),
    );
    changes.push(...commitSnapshot(prepared.retained));
  }
  return changes;
};
