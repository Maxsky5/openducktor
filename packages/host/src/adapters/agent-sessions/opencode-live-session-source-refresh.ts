import type { OpencodeWorkflowRootRead } from "@openducktor/adapters-opencode-sdk";
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
  StagedOpenCodeRequest,
} from "./opencode-pending-request-router";
import {
  openCodeActivityForPending,
  type OpenCodeLiveSnapshotInput,
  type OpenCodeRetainedSession,
  parseOpenCodeLiveSnapshot,
} from "./opencode-live-session-state-policy";

type ApplyOpenCodeWorkflowRootsInput = {
  runtime: OpenCodeRuntimeInstance;
  results: ReadonlyArray<OpencodeWorkflowRootRead>;
  oldRoots: ReadonlyArray<AgentSessionLiveRef>;
  snapshots: ReadonlyArray<AgentSessionLiveSnapshot>;
  contextUsageBySessionId: ReadonlyMap<string, AgentSessionContextUsage>;
  pendingRequests: OpenCodePendingRequestRouter;
  saveSession: (session: OpenCodeRetainedSession) => AgentSessionLiveAdapterChange[];
  removeSession: (ref: AgentSessionLiveRef) => AgentSessionLiveAdapterChange[];
};

type StagedRequest = StagedOpenCodeRequest<
  | AgentSessionLiveSnapshot["pendingApprovals"][number]
  | AgentSessionLiveSnapshot["pendingQuestions"][number]
>;

type StagedSession = {
  readonly session: OpenCodeRetainedSession;
  readonly requests: ReadonlyArray<StagedRequest>;
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

export const applyOpenCodeWorkflowRoots = ({
  runtime,
  results,
  oldRoots,
  snapshots,
  contextUsageBySessionId,
  pendingRequests,
  saveSession,
  removeSession,
}: ApplyOpenCodeWorkflowRootsInput): AgentSessionLiveAdapterChange[] => {
  const snapshotsByRef = new Map(snapshots.map((snapshot) => [refKey(snapshot.ref), snapshot]));
  const refsToDrop: AgentSessionLiveRef[] = [];
  const stagedSessions: StagedSession[] = [];
  const nextRootKeys = new Set(results.map(({ ref }) => refKey(ref)));
  for (const ref of oldRoots) {
    if (!nextRootKeys.has(refKey(ref))) {
      refsToDrop.push(ref);
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
      refsToDrop.push(result.ref);
      continue;
    }
    const root = result.sources.find(
      (source) =>
        source.externalSessionId === result.ref.externalSessionId &&
        source.workingDirectory === result.ref.workingDirectory &&
        source.parentExternalSessionId === undefined,
    );
    if (!root) {
      throw new HostValidationError({
        field: "registeredSessionRef",
        message: `OpenCode did not return registered session '${result.ref.externalSessionId}' in '${result.ref.workingDirectory}'.`,
        details: { runtimeId: runtime.runtimeId, ref: result.ref },
      });
    }

    const readKeys = new Set(
      result.sources.map((source) =>
        refKey({
          repoPath: runtime.repoPath,
          runtimeKind: "opencode",
          workingDirectory: source.workingDirectory,
          externalSessionId: source.externalSessionId,
        }),
      ),
    );
    for (const snapshot of snapshots) {
      if (
        isDescendantOf(snapshot, result.ref, snapshotsByRef) &&
        !readKeys.has(refKey(snapshot.ref))
      ) {
        refsToDrop.push(snapshot.ref);
      }
    }

    for (const source of result.sources) {
      const ref: AgentSessionLiveRef = {
        repoPath: runtime.repoPath,
        runtimeKind: "opencode",
        workingDirectory: source.workingDirectory,
        externalSessionId: source.externalSessionId,
      };
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
      const base: OpenCodeRetainedSession = {
        runtimeActivity: source.runtimeActivity,
        snapshot: parseOpenCodeLiveSnapshot(
          snapshotInput,
          "opencode-live-session.refresh-registered-source",
        ),
      };
      stagedSessions.push({
        session: {
          ...base,
          snapshot: parseOpenCodeLiveSnapshot(
            { ...base.snapshot, activity: openCodeActivityForPending(base) },
            "opencode-live-session.refresh-registered-activity",
          ),
        },
        requests: [...approvals, ...questions],
      });
    }
  }

  const changes: AgentSessionLiveAdapterChange[] = [];
  for (const ref of refsToDrop) {
    changes.push(...removeSession(ref));
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
