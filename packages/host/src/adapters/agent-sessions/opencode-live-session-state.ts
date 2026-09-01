import type { OpencodeSessionContextUsage } from "@openducktor/adapters-opencode-sdk";
import {
  type AgentSessionContextUsage,
  type AgentSessionLiveReadResult,
  type AgentSessionLiveRef,
  type AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import type { AgentEvent, AgentSessionSummary } from "@openducktor/core";
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
import { toOpenCodeRetainedControlSummary } from "./opencode-live-session-control-summary";
import { applyOpenCodeWorkflowRoots } from "./opencode-live-session-source-refresh";
import {
  openCodeActivityForPending,
  openCodeActivityFromEvent,
  openCodeEventChildId,
  openCodeEventParentId,
  openCodeLiveSnapshotsEqual,
  type OpenCodeRetainedSession,
  parseOpenCodeLiveSnapshot,
} from "./opencode-live-session-state-policy";

export const createOpenCodeLiveSessionState = ({
  runtime,
  nextOccurrenceId,
}: {
  readonly runtime: OpenCodeRuntimeInstance;
  readonly nextOccurrenceId: () => string;
}) => {
  const sessionsByRef = new Map<string, OpenCodeRetainedSession>();
  let dropCount = 0;
  const workflowRootsByRef = new Map<string, AgentSessionLiveRef>();
  const contextUsageBySessionId = new Map<string, AgentSessionContextUsage>();
  const pendingRequests = createOpenCodePendingRequestRouter({
    runtimeId: runtime.runtimeId,
    nextOccurrenceId,
  });

  const requireSession = (ref: AgentSessionLiveRef): OpenCodeRetainedSession => {
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

  const commitSnapshot = (retained: OpenCodeRetainedSession): AgentSessionLiveAdapterChange[] => {
    const key = refKey(retained.snapshot.ref);
    const previous = sessionsByRef.get(key)?.snapshot;
    sessionsByRef.set(key, retained);
    return previous && openCodeLiveSnapshotsEqual(previous, retained.snapshot)
      ? []
      : [{ type: "session_upsert", snapshot: retained.snapshot }];
  };

  const ensureEventSession = (
    ownerRef: AgentSessionLiveRef,
    event: AgentEvent,
  ): OpenCodeRetainedSession => {
    const childExternalSessionId = openCodeEventChildId(event);
    const parentExternalSessionId = openCodeEventParentId(event);
    if (!childExternalSessionId || childExternalSessionId === ownerRef.externalSessionId) {
      return requireSession(ownerRef);
    }
    if (!parentExternalSessionId) {
      throw new HostValidationError({
        field: "parentExternalSessionId",
        message: `OpenCode event for child session '${childExternalSessionId}' has no registered parent lineage.`,
        details: { runtimeId: runtime.runtimeId, externalSessionId: childExternalSessionId },
      });
    }
    const parentRef = { ...toSessionRef(ownerRef), externalSessionId: parentExternalSessionId };
    if (!sessionsByRef.has(refKey(parentRef))) {
      throw new HostValidationError({
        field: "parentExternalSessionId",
        message: `OpenCode event for child session '${childExternalSessionId}' names unregistered parent '${parentExternalSessionId}'.`,
        details: {
          runtimeId: runtime.runtimeId,
          externalSessionId: childExternalSessionId,
          parentExternalSessionId,
        },
      });
    }
    const childRef = { ...toSessionRef(ownerRef), externalSessionId: childExternalSessionId };
    const existing = sessionsByRef.get(refKey(childRef));
    if (existing) {
      if (existing.snapshot.parentExternalSessionId !== parentExternalSessionId) {
        throw new HostValidationError({
          field: "parentExternalSessionId",
          message: `OpenCode child session '${childExternalSessionId}' changed parent from '${existing.snapshot.parentExternalSessionId ?? "none"}' to '${parentExternalSessionId}'.`,
          details: {
            runtimeId: runtime.runtimeId,
            externalSessionId: childExternalSessionId,
            parentExternalSessionId,
          },
        });
      }
      return existing;
    }
    const title =
      event.type === "assistant_part" && event.part.kind === "subagent"
        ? (event.part.agent ?? event.part.description ?? "OpenCode subagent")
        : "OpenCode subagent";
    const snapshot = parseOpenCodeLiveSnapshot(
      {
        ref: childRef,
        activity: "idle",
        title,
        startedAt: event.timestamp,
        parentExternalSessionId: parentExternalSessionId,
        pendingApprovals: [],
        pendingQuestions: [],
        contextUsage: contextUsageBySessionId.get(childExternalSessionId) ?? null,
      },
      "opencode-live-session.create-child-event-state",
    );
    const retained = { snapshot, runtimeActivity: "idle" as const };
    return retained;
  };

  const retainContext = (
    externalSessionId: string,
    usage: OpencodeSessionContextUsage,
  ): AgentSessionLiveAdapterChange[] => {
    const contextUsage = toContextUsage(usage);
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
    if (!retained) {
      contextUsageBySessionId.set(externalSessionId, contextUsage);
      return [];
    }
    if (openCodeLiveSnapshotsEqual(retained.snapshot, { ...retained.snapshot, contextUsage })) {
      contextUsageBySessionId.set(externalSessionId, contextUsage);
      return [];
    }
    const next = {
      ...retained,
      snapshot: parseOpenCodeLiveSnapshot(
        { ...retained.snapshot, contextUsage },
        "opencode-live-session.retain-context",
      ),
    };
    contextUsageBySessionId.set(externalSessionId, contextUsage);
    return commitSnapshot(next);
  };

  const applyLoadedContext = (
    ref: AgentSessionLiveRef,
    usage: OpencodeSessionContextUsage | null,
  ) => {
    const retained = sessionsByRef.get(refKey(ref));
    if (retained?.snapshot.contextUsage) {
      return { value: retained.snapshot.contextUsage, changes: [] };
    }
    if (!usage) {
      return { value: null, changes: [] };
    }
    const contextUsage = toContextUsage(usage);
    return {
      value: contextUsage,
      changes: retained ? retainContext(ref.externalSessionId, usage) : [],
    };
  };

  const retainControlSummary = (summary: AgentSessionSummary): AgentSessionLiveAdapterChange[] => {
    const ref: AgentSessionLiveRef = {
      repoPath: runtime.repoPath,
      runtimeKind: "opencode",
      workingDirectory: summary.workingDirectory,
      externalSessionId: summary.externalSessionId,
    };
    return commitSnapshot(
      toOpenCodeRetainedControlSummary({
        runtime,
        summary,
        previous: sessionsByRef.get(refKey(ref)),
        contextUsage: contextUsageBySessionId.get(summary.externalSessionId),
      }),
    );
  };

  const applyEvent = (
    ownerRef: AgentSessionLiveRef,
    event: AgentEvent,
  ): AgentSessionLiveAdapterChange[] => {
    requireSession(ownerRef);
    const retained = ensureEventSession(ownerRef, event);
    const ref = retained.snapshot.ref;
    if (event.type === "approval_required") {
      const {
        type: _type,
        externalSessionId: _externalSessionId,
        timestamp: _timestamp,
        parentExternalSessionId: _parentExternalSessionId,
        childExternalSessionId: _childExternalSessionId,
        subagentCorrelationKey: _subagentCorrelationKey,
        ...nativeRequest
      } = event;
      const staged = pendingRequests.stageApproval(ref, nativeRequest);
      const next = {
        ...retained,
        snapshot: parseOpenCodeLiveSnapshot(
          {
            ...retained.snapshot,
            activity: "waiting_for_permission",
            pendingApprovals: [
              ...retained.snapshot.pendingApprovals.filter(
                (candidate) => candidate.requestId !== staged.request.requestId,
              ),
              staged.request,
            ],
          },
          "opencode-live-session.retain-approval",
        ),
      };
      pendingRequests.save(staged);
      return commitSnapshot(next);
    }
    if (event.type === "question_required") {
      const {
        type: _type,
        externalSessionId: _externalSessionId,
        timestamp: _timestamp,
        parentExternalSessionId: _parentExternalSessionId,
        childExternalSessionId: _childExternalSessionId,
        subagentCorrelationKey: _subagentCorrelationKey,
        ...nativeRequest
      } = event;
      const staged = pendingRequests.stageQuestion(ref, nativeRequest);
      const next = {
        ...retained,
        snapshot: parseOpenCodeLiveSnapshot(
          {
            ...retained.snapshot,
            activity: "waiting_for_question",
            pendingQuestions: [
              ...retained.snapshot.pendingQuestions.filter(
                (candidate) => candidate.requestId !== staged.request.requestId,
              ),
              staged.request,
            ],
          },
          "opencode-live-session.retain-question",
        ),
      };
      pendingRequests.save(staged);
      return commitSnapshot(next);
    }
    if (event.type === "approval_resolved" || event.type === "question_resolved") {
      const kind = event.type === "approval_resolved" ? "approval" : "question";
      const route = pendingRequests.findNative(ref, event.requestId, kind);
      if (!route) {
        return [];
      }
      const next: OpenCodeRetainedSession = {
        ...retained,
        snapshot: parseOpenCodeLiveSnapshot(
          {
            ...retained.snapshot,
            pendingApprovals:
              kind === "approval"
                ? retained.snapshot.pendingApprovals.filter(
                    (candidate) => candidate.requestId !== route.occurrenceId,
                  )
                : retained.snapshot.pendingApprovals,
            pendingQuestions:
              kind === "question"
                ? retained.snapshot.pendingQuestions.filter(
                    (candidate) => candidate.requestId !== route.occurrenceId,
                  )
                : retained.snapshot.pendingQuestions,
          },
          "opencode-live-session.resolve-pending-input",
        ),
      };
      next.snapshot = parseOpenCodeLiveSnapshot(
        { ...next.snapshot, activity: openCodeActivityForPending(next) },
        "opencode-live-session.settle-pending-activity",
      );
      pendingRequests.complete(route);
      return commitSnapshot(next);
    }
    if (event.type === "assistant_part" && event.part.kind === "subagent") {
      const running = event.part.status === "pending" || event.part.status === "running";
      const next = {
        ...retained,
        runtimeActivity: running ? ("running" as const) : ("idle" as const),
        snapshot: parseOpenCodeLiveSnapshot(
          {
            ...retained.snapshot,
            activity: openCodeActivityForPending({
              ...retained,
              runtimeActivity: running ? "running" : "idle",
            }),
            title: event.part.agent ?? event.part.description ?? retained.snapshot.title,
          },
          "opencode-live-session.retain-subagent",
        ),
      };
      return commitSnapshot(next);
    }
    const runtimeActivity = openCodeActivityFromEvent(event);
    if (!runtimeActivity) {
      return [];
    }
    let next: OpenCodeRetainedSession = { ...retained, runtimeActivity };
    if (event.type === "session_error" || event.type === "session_finished") {
      next = {
        ...next,
        snapshot: parseOpenCodeLiveSnapshot(
          { ...next.snapshot, pendingApprovals: [], pendingQuestions: [] },
          "opencode-live-session.settle-session",
        ),
      };
    }
    next = {
      ...next,
      snapshot: parseOpenCodeLiveSnapshot(
        { ...next.snapshot, activity: openCodeActivityForPending(next) },
        "opencode-live-session.retain-activity",
      ),
    };
    if (event.type === "session_error" || event.type === "session_finished") {
      pendingRequests.removeSession(ref);
    }
    return commitSnapshot(next);
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
    const retained = requireSession(route.ref);
    const next: OpenCodeRetainedSession = {
      ...retained,
      snapshot: parseOpenCodeLiveSnapshot(
        {
          ...retained.snapshot,
          pendingApprovals:
            route.kind === "approval"
              ? retained.snapshot.pendingApprovals.filter(
                  (request) => request.requestId !== route.occurrenceId,
                )
              : retained.snapshot.pendingApprovals,
          pendingQuestions:
            route.kind === "question"
              ? retained.snapshot.pendingQuestions.filter(
                  (request) => request.requestId !== route.occurrenceId,
                )
              : retained.snapshot.pendingQuestions,
        },
        "opencode-live-session.complete-pending-reply",
      ),
    };
    next.snapshot = parseOpenCodeLiveSnapshot(
      { ...next.snapshot, activity: openCodeActivityForPending(next) },
      "opencode-live-session.complete-pending-activity",
    );
    if (!pendingRequests.complete(route)) {
      return [];
    }
    return commitSnapshot(next);
  };

  const removeSession = (ref: AgentSessionLiveRef): AgentSessionLiveAdapterChange[] => {
    const refs = [toSessionRef(ref)];
    for (let index = 0; index < refs.length; index += 1) {
      const parent = refs[index];
      if (!parent) {
        continue;
      }
      for (const retained of sessionsByRef.values()) {
        if (
          retained.snapshot.parentExternalSessionId === parent.externalSessionId &&
          !refs.some((candidate) => refsEqual(candidate, retained.snapshot.ref))
        ) {
          refs.push(toSessionRef(retained.snapshot.ref));
        }
      }
    }
    const changes: AgentSessionLiveAdapterChange[] = [];
    for (const candidate of refs.reverse()) {
      const key = refKey(candidate);
      const retained = sessionsByRef.get(key);
      if (!retained || !refsEqual(retained.snapshot.ref, candidate)) {
        continue;
      }
      sessionsByRef.delete(key);
      dropCount += 1;
      contextUsageBySessionId.delete(candidate.externalSessionId);
      pendingRequests.removeSession(candidate);
      changes.push({ type: "session_removed", ref: candidate });
    }
    return changes;
  };

  return {
    has: (ref: AgentSessionLiveRef): boolean => sessionsByRef.has(refKey(ref)),
    listSnapshots: (): AgentSessionLiveSnapshot[] =>
      [...sessionsByRef.values()].map(({ snapshot }) =>
        parseOpenCodeLiveSnapshot(snapshot, "opencode-live-session.clone-retained-snapshot"),
      ),
    readSnapshot: (ref: AgentSessionLiveRef): AgentSessionLiveReadResult => {
      const snapshot = sessionsByRef.get(refKey(ref))?.snapshot;
      return snapshot
        ? {
            type: "live",
            session: parseOpenCodeLiveSnapshot(snapshot, "opencode-live-session.read-snapshot"),
          }
        : { type: "missing", ref: toSessionRef(ref) };
    },
    contextUsage: (ref: AgentSessionLiveRef): AgentSessionContextUsage | null =>
      sessionsByRef.get(refKey(ref))?.snapshot.contextUsage ?? null,
    dropCount: (): number => dropCount,
    retainContext,
    applyLoadedContext,
    retainControlSummary,
    applyWorkflowRoots: (
      results: Parameters<typeof applyOpenCodeWorkflowRoots>[0]["results"],
    ): AgentSessionLiveAdapterChange[] => {
      const changes = applyOpenCodeWorkflowRoots({
        runtime,
        results,
        oldRoots: [...workflowRootsByRef.values()],
        snapshots: [...sessionsByRef.values()].map(({ snapshot }) => snapshot),
        contextUsageBySessionId,
        pendingRequests,
        saveSession: commitSnapshot,
        removeSession,
      });
      workflowRootsByRef.clear();
      for (const result of results) {
        workflowRootsByRef.set(refKey(result.ref), toSessionRef(result.ref));
      }
      return changes;
    },
    applyEvent,
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
      dropCount += refs.length;
      sessionsByRef.clear();
      workflowRootsByRef.clear();
      pendingRequests.clear();
      contextUsageBySessionId.clear();
      return refs;
    },
  };
};
