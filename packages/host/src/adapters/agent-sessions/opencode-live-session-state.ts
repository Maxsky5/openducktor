import { assertApprovalAllowed } from "./opencode-approval-authorization";
import { OpenCodeSessionRefIndex } from "./opencode-live-session-ref-index";
import type {
  OpencodeRuntimeSnapshotRead,
  OpencodeSessionContextUsage,
} from "@openducktor/adapters-opencode-sdk";
import {
  type AgentSessionContextUsage,
  type AgentSessionLiveReadResult,
  type AgentSessionLiveRef,
  type AgentSessionLiveSnapshot,
  type RuntimeApprovalReplyOutcome,
} from "@openducktor/contracts";
import type { AgentEvent, AgentSessionSummary } from "@openducktor/core";
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
  openCodeLiveSnapshotsEqual,
  type OpenCodeLiveSession,
  parseOpenCodeLiveSnapshot,
  requireOpenCodeLiveSession,
  requireOpenCodeEventSession,
  withConfirmedStatus,
} from "./opencode-live-session-state-policy";
import {
  type OpenCodeSessionReadStart,
  OpenCodeSessionVersions,
} from "./opencode-live-session-versions";

export const createOpenCodeLiveSessionState = ({
  runtime,
  nextOccurrenceId,
}: {
  readonly runtime: OpenCodeRuntimeInstance;
  readonly nextOccurrenceId: () => string;
}) => {
  const sessionsByRef = new Map<string, OpenCodeLiveSession>();
  const refsByExternalSessionId = new OpenCodeSessionRefIndex(runtime.runtimeId);
  const contextUsageBySessionId = new Map<string, AgentSessionContextUsage>();
  const versions = new OpenCodeSessionVersions();
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
    refsByExternalSessionId.set(session.snapshot.ref);
    if (previous && openCodeLiveSnapshotsEqual(previous, session.snapshot)) {
      return [];
    }
    versions.snapshotChanged(session.snapshot.ref);
    return [{ type: "session_upsert", snapshot: session.snapshot }];
  };

  /** A confirmed status makes the status of each runtime read in progress outdated. */
  const commitStatus = (session: OpenCodeLiveSession): AgentSessionLiveAdapterChange[] => {
    versions.statusConfirmed(session.snapshot.ref);
    return commitSnapshot(session);
  };

  const setContext = (
    externalSessionId: string,
    usage: OpencodeSessionContextUsage,
  ): AgentSessionLiveAdapterChange[] => {
    const contextUsage = toContextUsage(usage);
    const ref = refsByExternalSessionId.find(externalSessionId);
    if (!ref) {
      contextUsageBySessionId.set(externalSessionId, contextUsage);
      return [];
    }
    const session = requireSession(ref);
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

  const applyControlSummary = (
    repoPath: string,
    summary: AgentSessionSummary,
    options: { readonly keepActivity?: boolean } = {},
  ): AgentSessionLiveAdapterChange[] => {
    const ref: AgentSessionLiveRef = {
      repoPath,
      runtimeKind: "opencode",
      workingDirectory: summary.workingDirectory,
      externalSessionId: summary.externalSessionId,
    };
    const previous = sessionsByRef.get(refKey(ref));
    const keepActivity = options.keepActivity === true && previous !== undefined;
    const session = toOpenCodeLiveSession({
      runtime,
      repoPath,
      summary,
      previous,
      contextUsage: contextUsageBySessionId.get(summary.externalSessionId),
      keepActivity,
    });
    return keepActivity ? commitSnapshot(session) : commitStatus(session);
  };

  const applyEvent = (
    ownerRef: AgentSessionLiveRef,
    event: AgentEvent,
  ): AgentSessionLiveAdapterChange[] => {
    requireSession(ownerRef);
    const session = requireOpenCodeEventSession({
      ownerRef,
      event,
      runtimeId: runtime.runtimeId,
      sessionsByRef,
      contextUsageBySessionId,
    });
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
            ...withConfirmedStatus(session.snapshot),
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
      return commitStatus(next);
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
            ...withConfirmedStatus(session.snapshot),
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
      return commitStatus(next);
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
            ...withConfirmedStatus(session.snapshot),
            activity: openCodeActivityForPending({
              ...session,
              runtimeActivity: running ? "running" : "idle",
            }),
            title: event.part.agent ?? event.part.description ?? session.snapshot.title,
          },
          "opencode-live-session.set-subagent",
        ),
      };
      return commitStatus(next);
    }
    const runtimeActivity = openCodeActivityFromEvent(event);
    if (!runtimeActivity) {
      return [];
    }
    let next: OpenCodeLiveSession = {
      ...session,
      runtimeActivity,
      snapshot: withConfirmedStatus(session.snapshot),
    };
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
    return commitStatus(next);
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
    refsByExternalSessionId.delete(ref);
    versions.removed(ref);
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
    readStart: (): OpenCodeSessionReadStart => versions.readStart(),
    setContext,
    applyLoadedContext,
    applyControlSummary,
    applySessionSources: (
      repoPath: string,
      read: OpencodeRuntimeSnapshotRead,
      readStart: OpenCodeSessionReadStart,
    ): AgentSessionLiveAdapterChange[] =>
      applyOpenCodeSessionSources({
        repoPath,
        runtimeId: runtime.runtimeId,
        sources: read.sources,
        failures: read.failures,
        sessions: sessionsByRef,
        contextUsageBySessionId,
        pendingRequests,
        readScope: (ref) => versions.readScope(ref, readStart),
        commitStatus,
        commitSnapshot,
        removeSession: dropSession,
      }),
    applyEvent,
    requirePendingRoute,
    assertApprovalAllowed: (
      route: OpenCodePendingRoute,
      outcome: RuntimeApprovalReplyOutcome,
    ): void =>
      assertApprovalAllowed({
        route,
        outcome,
        sessionsByRef,
        refsByExternalSessionId,
        runtimeId: runtime.runtimeId,
      }),
    completePendingReply,
    removeSession,
    refForExternalSession: (externalSessionId: string): AgentSessionLiveRef | null =>
      refsByExternalSessionId.find(externalSessionId),
    release: (): AgentSessionLiveRef[] => {
      const refs = [...sessionsByRef.values()].map(({ snapshot }) => toSessionRef(snapshot.ref));
      for (const ref of refs) {
        versions.removed(ref);
      }
      sessionsByRef.clear();
      refsByExternalSessionId.clear();
      pendingRequests.clear();
      contextUsageBySessionId.clear();
      return refs;
    },
  };
};
