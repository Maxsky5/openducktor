import type {
  OpencodeRuntimeSnapshotRead,
  OpencodeSessionContextUsage,
} from "@openducktor/adapters-opencode-sdk";
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
import { toOpenCodeLiveSession } from "./opencode-live-session-control-summary";
import { applyOpenCodeSessionSources } from "./opencode-live-session-source-refresh";
import {
  openCodeActivityForPending,
  openCodeActivityFromEvent,
  openCodeEventChildId,
  openCodeEventParentId,
  openCodeLiveSnapshotsEqual,
  type OpenCodeLiveSession,
  parseOpenCodeLiveSnapshot,
  requireOpenCodeLiveSession,
} from "./opencode-live-session-state-policy";

export const createOpenCodeLiveSessionState = ({
  runtime,
  nextOccurrenceId,
}: {
  readonly runtime: OpenCodeRuntimeInstance;
  readonly nextOccurrenceId: () => string;
}) => {
  const sessionsByRef = new Map<string, OpenCodeLiveSession>();
  const contextUsageBySessionId = new Map<string, AgentSessionContextUsage>();
  const versionsByRef = new Map<string, number>();
  const pendingRequests = createOpenCodePendingRequestRouter({
    runtimeId: runtime.runtimeId,
    nextOccurrenceId,
  });

  const requireSession = (ref: AgentSessionLiveRef): OpenCodeLiveSession =>
    requireOpenCodeLiveSession(sessionsByRef, runtime.runtimeId, ref);

  const commitSnapshot = (session: OpenCodeLiveSession): AgentSessionLiveAdapterChange[] => {
    const key = refKey(session.snapshot.ref);
    const previous = sessionsByRef.get(key)?.snapshot;
    sessionsByRef.set(key, session);
    if (previous && openCodeLiveSnapshotsEqual(previous, session.snapshot)) {
      return [];
    }
    versionsByRef.set(key, (versionsByRef.get(key) ?? 0) + 1);
    return [{ type: "session_upsert", snapshot: session.snapshot }];
  };

  const ensureEventSession = (
    ownerRef: AgentSessionLiveRef,
    event: AgentEvent,
  ): OpenCodeLiveSession => {
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
    return { snapshot, runtimeActivity: "idle" as const };
  };

  const setContext = (
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
        message: `OpenCode runtime '${runtime.runtimeId}' has multiple live sessions with id '${externalSessionId}'.`,
        details: { runtimeId: runtime.runtimeId, externalSessionId },
      });
    }
    const session = matches[0];
    if (!session) {
      contextUsageBySessionId.set(externalSessionId, contextUsage);
      return [];
    }
    if (openCodeLiveSnapshotsEqual(session.snapshot, { ...session.snapshot, contextUsage })) {
      contextUsageBySessionId.set(externalSessionId, contextUsage);
      return [];
    }
    const next = {
      ...session,
      snapshot: parseOpenCodeLiveSnapshot(
        { ...session.snapshot, contextUsage },
        "opencode-live-session.set-context",
      ),
    };
    contextUsageBySessionId.set(externalSessionId, contextUsage);
    return commitSnapshot(next);
  };

  const applyLoadedContext = (
    ref: AgentSessionLiveRef,
    usage: OpencodeSessionContextUsage | null,
  ) => {
    const session = sessionsByRef.get(refKey(ref));
    if (session?.snapshot.contextUsage) {
      return { value: session.snapshot.contextUsage, changes: [] };
    }
    if (!usage) {
      return { value: null, changes: [] };
    }
    const contextUsage = toContextUsage(usage);
    return {
      value: contextUsage,
      changes: session ? setContext(ref.externalSessionId, usage) : [],
    };
  };

  const applyControlSummary = (summary: AgentSessionSummary): AgentSessionLiveAdapterChange[] => {
    const ref: AgentSessionLiveRef = {
      repoPath: runtime.repoPath,
      runtimeKind: "opencode",
      workingDirectory: summary.workingDirectory,
      externalSessionId: summary.externalSessionId,
    };
    return commitSnapshot(
      toOpenCodeLiveSession({
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
    const session = ensureEventSession(ownerRef, event);
    const ref = session.snapshot.ref;
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
        ...session,
        snapshot: parseOpenCodeLiveSnapshot(
          {
            ...session.snapshot,
            activity: "waiting_for_permission",
            pendingApprovals: [
              ...session.snapshot.pendingApprovals.filter(
                (candidate) => candidate.requestId !== staged.request.requestId,
              ),
              staged.request,
            ],
          },
          "opencode-live-session.set-approval",
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
        ...session,
        snapshot: parseOpenCodeLiveSnapshot(
          {
            ...session.snapshot,
            activity: "waiting_for_question",
            pendingQuestions: [
              ...session.snapshot.pendingQuestions.filter(
                (candidate) => candidate.requestId !== staged.request.requestId,
              ),
              staged.request,
            ],
          },
          "opencode-live-session.set-question",
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
      const next: OpenCodeLiveSession = {
        ...session,
        snapshot: parseOpenCodeLiveSnapshot(
          {
            ...session.snapshot,
            pendingApprovals:
              kind === "approval"
                ? session.snapshot.pendingApprovals.filter(
                    (candidate) => candidate.requestId !== route.occurrenceId,
                  )
                : session.snapshot.pendingApprovals,
            pendingQuestions:
              kind === "question"
                ? session.snapshot.pendingQuestions.filter(
                    (candidate) => candidate.requestId !== route.occurrenceId,
                  )
                : session.snapshot.pendingQuestions,
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
        ...session,
        runtimeActivity: running ? ("running" as const) : ("idle" as const),
        snapshot: parseOpenCodeLiveSnapshot(
          {
            ...session.snapshot,
            activity: openCodeActivityForPending({
              ...session,
              runtimeActivity: running ? "running" : "idle",
            }),
            title: event.part.agent ?? event.part.description ?? session.snapshot.title,
          },
          "opencode-live-session.set-subagent",
        ),
      };
      return commitSnapshot(next);
    }
    const runtimeActivity = openCodeActivityFromEvent(event);
    if (!runtimeActivity) {
      return [];
    }
    let next: OpenCodeLiveSession = { ...session, runtimeActivity };
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
        "opencode-live-session.set-activity",
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
    const session = requireSession(route.ref);
    const next: OpenCodeLiveSession = {
      ...session,
      snapshot: parseOpenCodeLiveSnapshot(
        {
          ...session.snapshot,
          pendingApprovals:
            route.kind === "approval"
              ? session.snapshot.pendingApprovals.filter(
                  (request) => request.requestId !== route.occurrenceId,
                )
              : session.snapshot.pendingApprovals,
          pendingQuestions:
            route.kind === "question"
              ? session.snapshot.pendingQuestions.filter(
                  (request) => request.requestId !== route.occurrenceId,
                )
              : session.snapshot.pendingQuestions,
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

  const dropSession = (ref: AgentSessionLiveRef): AgentSessionLiveAdapterChange[] => {
    const key = refKey(ref);
    const session = sessionsByRef.get(key);
    if (!session || !refsEqual(session.snapshot.ref, ref)) {
      return [];
    }
    sessionsByRef.delete(key);
    versionsByRef.set(key, (versionsByRef.get(key) ?? 0) + 1);
    contextUsageBySessionId.delete(ref.externalSessionId);
    pendingRequests.removeSession(ref);
    return [{ type: "session_removed", ref: toSessionRef(ref) }];
  };

  const removeSession = (ref: AgentSessionLiveRef): AgentSessionLiveAdapterChange[] => {
    const refs = [toSessionRef(ref)];
    for (let index = 0; index < refs.length; index += 1) {
      const parent = refs[index];
      if (!parent) {
        continue;
      }
      for (const session of sessionsByRef.values()) {
        if (
          session.snapshot.parentExternalSessionId === parent.externalSessionId &&
          !refs.some((candidate) => refsEqual(candidate, session.snapshot.ref))
        ) {
          refs.push(toSessionRef(session.snapshot.ref));
        }
      }
    }
    const changes: AgentSessionLiveAdapterChange[] = [];
    for (const candidate of refs.reverse()) {
      changes.push(...dropSession(candidate));
    }
    return changes;
  };

  return {
    listSnapshots: (): AgentSessionLiveSnapshot[] =>
      [...sessionsByRef.values()].map(({ snapshot }) =>
        parseOpenCodeLiveSnapshot(snapshot, "opencode-live-session.clone-snapshot"),
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
    versions: (): ReadonlyMap<string, number> => new Map(versionsByRef),
    setContext,
    applyLoadedContext,
    applyControlSummary,
    applySessionSources: (
      read: OpencodeRuntimeSnapshotRead,
      readVersions: ReadonlyMap<string, number>,
    ): AgentSessionLiveAdapterChange[] => {
      return applyOpenCodeSessionSources({
        runtime,
        sources: read.sources,
        failures: read.failures,
        snapshots: [...sessionsByRef.values()].map(({ snapshot }) => snapshot),
        contextUsageBySessionId,
        pendingRequests,
        saveSession: commitSnapshot,
        isFresh: (ref) =>
          (readVersions.get(refKey(ref)) ?? 0) === (versionsByRef.get(refKey(ref)) ?? 0),
        removeSession: dropSession,
      });
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
      for (const ref of refs) {
        const key = refKey(ref);
        versionsByRef.set(key, (versionsByRef.get(key) ?? 0) + 1);
      }
      sessionsByRef.clear();
      pendingRequests.clear();
      contextUsageBySessionId.clear();
      return refs;
    },
  };
};
