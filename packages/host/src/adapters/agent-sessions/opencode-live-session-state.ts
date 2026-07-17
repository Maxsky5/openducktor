import type {
  OpencodeRuntimeSnapshotSource,
  OpencodeSessionContextUsage,
} from "@openducktor/adapters-opencode-sdk";
import {
  type AgentSessionActivity,
  type AgentSessionContextUsage,
  type AgentSessionControlSummary,
  type AgentSessionLiveReadResult,
  type AgentSessionLiveRef,
  type AgentSessionLiveSnapshot,
  agentSessionLiveSnapshotSchema,
} from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import type { OpenCodeRuntimeInstance } from "./opencode-live-session-normalization";
import {
  refKey,
  refsEqual,
  toContextUsage,
  toSessionRef,
} from "./opencode-live-session-normalization";
import {
  createOpenCodePendingRequestRouter,
  type OpenCodePendingRoute,
} from "./opencode-pending-request-router";

type RetainedSession = {
  snapshot: AgentSessionLiveSnapshot;
  runtimeActivity: OpencodeRuntimeSnapshotSource["runtimeActivity"];
};

type CreateOpenCodeLiveSessionStateInput = {
  readonly runtime: OpenCodeRuntimeInstance;
  readonly nextOccurrenceId: () => string;
};

const snapshotsEqual = (left: AgentSessionLiveSnapshot, right: AgentSessionLiveSnapshot): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const classifyActivity = (input: {
  readonly runtimeActivity: AgentSessionActivity;
  readonly pendingApprovals: readonly unknown[];
  readonly pendingQuestions: readonly unknown[];
}): AgentSessionActivity => {
  if (input.pendingQuestions.length > 0) {
    return "waiting_for_question";
  }
  if (input.pendingApprovals.length > 0) {
    return "waiting_for_permission";
  }
  return input.runtimeActivity;
};

const parseSnapshot = (value: unknown, operation: string): AgentSessionLiveSnapshot => {
  try {
    return agentSessionLiveSnapshotSchema.parse(value);
  } catch (cause) {
    throw new HostValidationError({
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
      details: { operation },
    });
  }
};

export const createOpenCodeLiveSessionState = ({
  runtime,
  nextOccurrenceId,
}: CreateOpenCodeLiveSessionStateInput) => {
  let sessionsByRef = new Map<string, RetainedSession>();
  const contextUsageBySessionId = new Map<string, AgentSessionContextUsage>();
  const pendingRequests = createOpenCodePendingRequestRouter({
    runtimeId: runtime.runtimeId,
    nextOccurrenceId,
  });

  const requireSession = (ref: AgentSessionLiveRef): RetainedSession => {
    const session = sessionsByRef.get(refKey(ref));
    if (!session || !refsEqual(session.snapshot.ref, ref)) {
      throw new HostValidationError({
        field: "sessionRef",
        message: `OpenCode session '${ref.externalSessionId}' does not belong to runtime '${runtime.runtimeId}' with the supplied reference.`,
        details: { runtimeId: runtime.runtimeId, ref },
      });
    }
    return session;
  };

  const buildSnapshot = (
    source: OpencodeRuntimeSnapshotSource,
    activeNativeKeys: Set<string>,
  ): AgentSessionLiveSnapshot => {
    const ref: AgentSessionLiveRef = {
      repoPath: runtime.repoPath,
      runtimeKind: "opencode",
      workingDirectory: source.workingDirectory,
      externalSessionId: source.externalSessionId,
    };
    const pendingApprovals = source.pendingApprovals.map((request) =>
      pendingRequests.projectApproval(ref, request, activeNativeKeys),
    );
    const pendingQuestions = source.pendingQuestions.map((request) =>
      pendingRequests.projectQuestion(ref, request, activeNativeKeys),
    );
    return parseSnapshot(
      {
        ref,
        activity: classifyActivity({
          runtimeActivity: source.runtimeActivity,
          pendingApprovals,
          pendingQuestions,
        }),
        title: source.title,
        startedAt: source.startedAt,
        ...(source.parentExternalSessionId
          ? { parentExternalSessionId: source.parentExternalSessionId }
          : {}),
        pendingApprovals,
        pendingQuestions,
        contextUsage: contextUsageBySessionId.get(source.externalSessionId) ?? null,
      },
      "opencode-live-session.normalize-snapshot",
    );
  };

  const replaceSources = (
    sources: OpencodeRuntimeSnapshotSource[],
    emitChanges: boolean,
  ): AgentSessionLiveAdapterChange[] => {
    const previous = sessionsByRef;
    const next = new Map<string, RetainedSession>();
    const activeNativeKeys = new Set<string>();
    for (const source of sources) {
      const snapshot = buildSnapshot(source, activeNativeKeys);
      next.set(refKey(snapshot.ref), {
        snapshot,
        runtimeActivity: source.runtimeActivity,
      });
    }
    pendingRequests.finishProjection(activeNativeKeys);
    sessionsByRef = next;
    if (!emitChanges) {
      return [];
    }
    const changes: AgentSessionLiveAdapterChange[] = [];
    for (const [key, retained] of next) {
      const previousSnapshot = previous.get(key)?.snapshot;
      if (!previousSnapshot || !snapshotsEqual(previousSnapshot, retained.snapshot)) {
        changes.push({ type: "session_upsert", snapshot: retained.snapshot });
      }
    }
    for (const [key, retained] of previous) {
      if (!next.has(key)) {
        contextUsageBySessionId.delete(retained.snapshot.ref.externalSessionId);
        changes.push({ type: "session_removed", ref: retained.snapshot.ref });
      }
    }
    return changes;
  };

  const retainContext = (
    externalSessionId: string,
    usage: OpencodeSessionContextUsage,
  ): AgentSessionLiveAdapterChange[] => {
    const contextUsage = toContextUsage(usage);
    contextUsageBySessionId.set(externalSessionId, contextUsage);
    const matches = [...sessionsByRef.values()].filter(
      ({ snapshot }) => snapshot.ref.externalSessionId === externalSessionId,
    );
    if (matches.length > 1) {
      throw new HostValidationError({
        field: "externalSessionId",
        message: `OpenCode runtime '${runtime.runtimeId}' retained multiple sessions with id '${externalSessionId}'.`,
        details: { runtimeId: runtime.runtimeId, externalSessionId },
      });
    }
    const retained = matches[0];
    if (!retained || snapshotsEqual(retained.snapshot, { ...retained.snapshot, contextUsage })) {
      return [];
    }
    retained.snapshot = parseSnapshot(
      { ...retained.snapshot, contextUsage },
      "opencode-live-session.retain-context",
    );
    return [{ type: "session_upsert", snapshot: retained.snapshot }];
  };

  const applyLoadedContext = (
    ref: AgentSessionLiveRef,
    usage: OpencodeSessionContextUsage | null,
  ): { value: AgentSessionContextUsage | null; changes: AgentSessionLiveAdapterChange[] } => {
    const retained = sessionsByRef.get(refKey(ref));
    if (retained?.snapshot.contextUsage) {
      return { value: retained.snapshot.contextUsage, changes: [] };
    }
    if (!usage) {
      return { value: null, changes: [] };
    }
    const contextUsage = toContextUsage(usage);
    if (!retained) {
      return { value: contextUsage, changes: [] };
    }
    const changes = retainContext(ref.externalSessionId, usage);
    return { value: contextUsage, changes };
  };

  const retainControlSummary = (
    summary: AgentSessionControlSummary,
    parentExternalSessionId?: string,
  ): AgentSessionLiveAdapterChange[] => {
    if (summary.runtimeKind !== "opencode") {
      throw new HostValidationError({
        field: "runtimeKind",
        message: `OpenCode runtime '${runtime.runtimeId}' returned runtime kind '${summary.runtimeKind}'.`,
        details: { runtimeId: runtime.runtimeId },
      });
    }
    const ref: AgentSessionLiveRef = {
      repoPath: runtime.repoPath,
      runtimeKind: "opencode",
      workingDirectory: summary.workingDirectory,
      externalSessionId: summary.externalSessionId,
    };
    const previous = sessionsByRef.get(refKey(ref));
    const runtimeActivity =
      summary.status === "starting" || summary.status === "running" ? "running" : "idle";
    const retainedParentExternalSessionId =
      parentExternalSessionId ?? previous?.snapshot.parentExternalSessionId;
    const pendingApprovals = previous?.snapshot.pendingApprovals ?? [];
    const pendingQuestions = previous?.snapshot.pendingQuestions ?? [];
    const snapshot = parseSnapshot(
      {
        ref,
        activity: classifyActivity({
          runtimeActivity,
          pendingApprovals,
          pendingQuestions,
        }),
        title: summary.title ?? previous?.snapshot.title ?? "OpenCode",
        startedAt: summary.startedAt,
        ...(retainedParentExternalSessionId
          ? { parentExternalSessionId: retainedParentExternalSessionId }
          : {}),
        pendingApprovals,
        pendingQuestions,
        contextUsage:
          contextUsageBySessionId.get(summary.externalSessionId) ??
          previous?.snapshot.contextUsage ??
          null,
      },
      "opencode-live-session.retain-control-summary",
    );
    sessionsByRef.set(refKey(ref), { snapshot, runtimeActivity });
    return previous && snapshotsEqual(previous.snapshot, snapshot)
      ? []
      : [{ type: "session_upsert", snapshot }];
  };

  const markRunning = (ref: AgentSessionLiveRef): AgentSessionLiveAdapterChange[] => {
    const retained = requireSession(ref);
    retained.runtimeActivity = "running";
    const activity = classifyActivity({
      runtimeActivity: retained.runtimeActivity,
      pendingApprovals: retained.snapshot.pendingApprovals,
      pendingQuestions: retained.snapshot.pendingQuestions,
    });
    if (retained.snapshot.activity === activity) {
      return [];
    }
    retained.snapshot = parseSnapshot(
      { ...retained.snapshot, activity },
      "opencode-live-session.mark-running",
    );
    return [{ type: "session_upsert", snapshot: retained.snapshot }];
  };

  const requirePendingRoute = (
    ref: AgentSessionLiveRef,
    occurrenceId: string,
    kind: OpenCodePendingRoute["kind"],
  ): OpenCodePendingRoute => {
    requireSession(ref);
    return pendingRequests.require(ref, occurrenceId, kind);
  };

  const completePendingReply = (route: OpenCodePendingRoute): AgentSessionLiveAdapterChange[] => {
    if (!pendingRequests.complete(route)) {
      return [];
    }
    const retained = requireSession(route.ref);
    const pendingApprovals =
      route.kind === "approval"
        ? retained.snapshot.pendingApprovals.filter(
            (request) => request.requestId !== route.occurrenceId,
          )
        : retained.snapshot.pendingApprovals;
    const pendingQuestions =
      route.kind === "question"
        ? retained.snapshot.pendingQuestions.filter(
            (request) => request.requestId !== route.occurrenceId,
          )
        : retained.snapshot.pendingQuestions;
    retained.snapshot = parseSnapshot(
      {
        ...retained.snapshot,
        activity: classifyActivity({
          runtimeActivity: retained.runtimeActivity,
          pendingApprovals,
          pendingQuestions,
        }),
        pendingApprovals,
        pendingQuestions,
      },
      "opencode-live-session.complete-pending-reply",
    );
    return [{ type: "session_upsert", snapshot: retained.snapshot }];
  };

  const removeSession = (ref: AgentSessionLiveRef): AgentSessionLiveAdapterChange[] => {
    const key = refKey(ref);
    const retained = sessionsByRef.get(key);
    if (!retained || !refsEqual(retained.snapshot.ref, ref)) {
      return [];
    }
    sessionsByRef.delete(key);
    contextUsageBySessionId.delete(ref.externalSessionId);
    pendingRequests.removeSession(ref);
    return [{ type: "session_removed", ref: toSessionRef(ref) }];
  };

  return {
    initialize: (
      sources: OpencodeRuntimeSnapshotSource[],
      initialContextUsageBySessionId: ReadonlyMap<string, OpencodeSessionContextUsage>,
    ): void => {
      for (const [sessionId, usage] of initialContextUsageBySessionId) {
        contextUsageBySessionId.set(sessionId, toContextUsage(usage));
      }
      replaceSources(sources, false);
    },
    refresh: (sources: OpencodeRuntimeSnapshotSource[]): AgentSessionLiveAdapterChange[] =>
      replaceSources(sources, true),
    has: (ref: AgentSessionLiveRef): boolean => sessionsByRef.has(refKey(ref)),
    listSnapshots: (): AgentSessionLiveSnapshot[] =>
      [...sessionsByRef.values()].map(({ snapshot }) =>
        parseSnapshot(snapshot, "opencode-live-session.clone-retained-snapshot"),
      ),
    readSnapshot: (ref: AgentSessionLiveRef): AgentSessionLiveReadResult => {
      const snapshot = sessionsByRef.get(refKey(ref))?.snapshot;
      return snapshot
        ? { type: "live", session: parseSnapshot(snapshot, "opencode-live-session.read-snapshot") }
        : { type: "missing", ref: toSessionRef(ref) };
    },
    contextUsage: (ref: AgentSessionLiveRef): AgentSessionContextUsage | null =>
      sessionsByRef.get(refKey(ref))?.snapshot.contextUsage ?? null,
    retainContext,
    applyLoadedContext,
    retainControlSummary,
    markRunning,
    requirePendingRoute,
    completePendingReply,
    removeSession,
    refForExternalSession: (externalSessionId: string): AgentSessionLiveRef | null => {
      const matches = [...sessionsByRef.values()].filter(
        ({ snapshot }) => snapshot.ref.externalSessionId === externalSessionId,
      );
      if (matches.length > 1) {
        throw new HostValidationError({
          field: "externalSessionId",
          message: `OpenCode runtime '${runtime.runtimeId}' cannot route ambiguous session id '${externalSessionId}'.`,
          details: { runtimeId: runtime.runtimeId, externalSessionId },
        });
      }
      return matches[0] ? toSessionRef(matches[0].snapshot.ref) : null;
    },
    release: (): AgentSessionLiveRef[] => {
      const refs = [...sessionsByRef.values()].map(({ snapshot }) => toSessionRef(snapshot.ref));
      sessionsByRef.clear();
      pendingRequests.clear();
      contextUsageBySessionId.clear();
      return refs;
    },
  };
};

export type OpenCodeLiveSessionState = ReturnType<typeof createOpenCodeLiveSessionState>;
