import {
  type AgentSessionContextUsage,
  type AgentSessionControlSummary,
  type AgentSessionLivePendingApprovalRequest,
  type AgentSessionLivePendingQuestionRequest,
  type AgentSessionLiveRef,
  type AgentSessionLiveSnapshot,
  agentSessionLiveSnapshotSchema,
  agentSessionTranscriptEventSchema,
  isAgentSessionTranscriptEventType,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import type { AgentEvent } from "@openducktor/core";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import type { ClaudeAgentSdkEvent, ClaudeSessionContext } from "../claude/claude-agent-sdk-types";

type ClaudeRuntimeInstance = RuntimeInstanceSummary & {
  readonly kind: "claude";
  readonly runtimeRoute: { readonly type: "host_service"; readonly identity: string };
};

const refKey = (ref: AgentSessionLiveRef): string =>
  [ref.repoPath, ref.runtimeKind, ref.workingDirectory, ref.externalSessionId].join("\u0000");

const snapshotsEqual = (left: AgentSessionLiveSnapshot, right: AgentSessionLiveSnapshot): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const cloneSnapshot = (snapshot: AgentSessionLiveSnapshot): AgentSessionLiveSnapshot =>
  agentSessionLiveSnapshotSchema.parse(snapshot);

const activityForSummary = (
  status: AgentSessionControlSummary["status"],
): AgentSessionLiveSnapshot["activity"] =>
  status === "starting" || status === "running" ? "running" : "idle";

const activityForPending = (
  snapshot: AgentSessionLiveSnapshot,
): AgentSessionLiveSnapshot["activity"] => {
  if (snapshot.pendingQuestions.length > 0) {
    return "waiting_for_question";
  }
  if (snapshot.pendingApprovals.length > 0) {
    return "waiting_for_permission";
  }
  return "running";
};

const activityForStatus = (
  status: Extract<AgentEvent, { type: "session_status" }>["status"],
  snapshot: AgentSessionLiveSnapshot,
): AgentSessionLiveSnapshot["activity"] => {
  if (status.type === "busy") {
    return "running";
  }
  if (status.type === "retry") {
    return "retrying";
  }
  const pendingActivity = activityForPending(snapshot);
  return pendingActivity === "running" ? "idle" : pendingActivity;
};

const toApprovalRequest = (
  event: Extract<AgentEvent, { type: "approval_required" }>,
): AgentSessionLivePendingApprovalRequest => ({
  requestId: event.requestId,
  requestType: event.requestType,
  title: event.title,
  ...(event.summary !== undefined ? { summary: event.summary } : {}),
  ...(event.details !== undefined ? { details: event.details } : {}),
  ...(event.affectedPaths !== undefined ? { affectedPaths: event.affectedPaths } : {}),
  ...(event.command !== undefined ? { command: event.command } : {}),
  ...(event.action !== undefined ? { action: event.action } : {}),
  ...(event.tool !== undefined ? { tool: event.tool } : {}),
  ...(event.mutation !== undefined ? { mutation: event.mutation } : {}),
  ...(event.supportedReplyOutcomes !== undefined
    ? { supportedReplyOutcomes: event.supportedReplyOutcomes }
    : {}),
});

const toQuestionRequest = (
  event: Extract<AgentEvent, { type: "question_required" }>,
): AgentSessionLivePendingQuestionRequest => ({
  requestId: event.requestId,
  questions: event.questions,
});

const eventRef = (
  session: ClaudeSessionContext,
  event: { readonly externalSessionId: string },
): AgentSessionLiveRef => ({
  repoPath: session.input.repoPath,
  runtimeKind: "claude",
  workingDirectory: session.input.workingDirectory,
  externalSessionId: event.externalSessionId,
});

const rootRef = (session: ClaudeSessionContext): AgentSessionLiveRef =>
  eventRef(session, { externalSessionId: session.externalSessionId });

const subagentStartedAt = (
  part: {
    readonly startedAtMs?: number;
  },
  fallback: string,
): string => {
  if (typeof part.startedAtMs !== "number") {
    return fallback;
  }
  const startedAt = new Date(part.startedAtMs);
  return Number.isNaN(startedAt.getTime()) ? fallback : startedAt.toISOString();
};

export const createClaudeLiveSessionState = ({
  runtime,
}: {
  readonly runtime: ClaudeRuntimeInstance;
}) => {
  const snapshotsByRef = new Map<string, AgentSessionLiveSnapshot>();
  const retiredSessionKeys = new Set<string>();
  const startupLeases = new Set<string>();

  const readSnapshot = (ref: AgentSessionLiveRef): AgentSessionLiveSnapshot | undefined =>
    snapshotsByRef.get(refKey(ref));

  const commitSnapshot = (snapshot: AgentSessionLiveSnapshot): AgentSessionLiveAdapterChange[] => {
    const parsed = cloneSnapshot(snapshot);
    const key = refKey(parsed.ref);
    const previous = snapshotsByRef.get(key);
    snapshotsByRef.set(key, parsed);
    return previous && snapshotsEqual(previous, parsed)
      ? []
      : [{ type: "session_upsert", snapshot: parsed }];
  };

  const ensureSnapshot = (
    session: ClaudeSessionContext,
    ref: AgentSessionLiveRef,
    timestamp: string,
  ): AgentSessionLiveSnapshot => {
    const retained = readSnapshot(ref);
    if (retained) {
      return retained;
    }
    const isRoot = ref.externalSessionId === session.externalSessionId;
    return {
      ref,
      activity: session.activity === "idle" ? "idle" : "running",
      title: isRoot ? (session.summary.title ?? "Claude session") : "Claude subagent",
      startedAt: isRoot ? session.startedAt : timestamp,
      ...(!isRoot ? { parentExternalSessionId: session.externalSessionId } : {}),
      pendingApprovals: [],
      pendingQuestions: [],
      contextUsage: null,
    };
  };

  const removeSnapshot = (ref: AgentSessionLiveRef): AgentSessionLiveAdapterChange[] => {
    const key = refKey(ref);
    retiredSessionKeys.add(key);
    startupLeases.delete(key);
    if (!snapshotsByRef.delete(key)) {
      return [];
    }
    return [{ type: "session_removed", ref }];
  };

  const removeSessionTree = (ref: AgentSessionLiveRef): AgentSessionLiveAdapterChange[] => {
    const changes = removeSnapshot(ref);
    for (const snapshot of [...snapshotsByRef.values()]) {
      if (
        snapshot.ref.repoPath === ref.repoPath &&
        snapshot.ref.runtimeKind === ref.runtimeKind &&
        snapshot.parentExternalSessionId === ref.externalSessionId
      ) {
        changes.push(...removeSnapshot(snapshot.ref));
      }
    }
    return changes;
  };

  const applyPendingEvent = (
    session: ClaudeSessionContext,
    event: Extract<
      AgentEvent,
      {
        type: "approval_required" | "approval_resolved" | "question_required" | "question_resolved";
      }
    >,
  ): AgentSessionLiveAdapterChange[] => {
    const ref = eventRef(session, event);
    const snapshot = ensureSnapshot(session, ref, event.timestamp);
    if (event.type === "approval_required") {
      const request = toApprovalRequest(event);
      return commitSnapshot({
        ...snapshot,
        activity: "waiting_for_permission",
        pendingApprovals: [
          ...snapshot.pendingApprovals.filter(
            (candidate) => candidate.requestId !== request.requestId,
          ),
          request,
        ],
      });
    }
    if (event.type === "question_required") {
      const request = toQuestionRequest(event);
      return commitSnapshot({
        ...snapshot,
        activity: "waiting_for_question",
        pendingQuestions: [
          ...snapshot.pendingQuestions.filter(
            (candidate) => candidate.requestId !== request.requestId,
          ),
          request,
        ],
      });
    }
    const nextSnapshot = {
      ...snapshot,
      pendingApprovals:
        event.type === "approval_resolved"
          ? snapshot.pendingApprovals.filter((candidate) => candidate.requestId !== event.requestId)
          : snapshot.pendingApprovals,
      pendingQuestions:
        event.type === "question_resolved"
          ? snapshot.pendingQuestions.filter((candidate) => candidate.requestId !== event.requestId)
          : snapshot.pendingQuestions,
    };
    return commitSnapshot({ ...nextSnapshot, activity: activityForPending(nextSnapshot) });
  };

  const applySubagentPart = (
    session: ClaudeSessionContext,
    event: Extract<AgentEvent, { type: "assistant_part" }>,
  ): AgentSessionLiveAdapterChange[] => {
    if (event.part.kind !== "subagent" || !event.part.externalSessionId) {
      return [];
    }
    const ref = eventRef(session, { externalSessionId: event.part.externalSessionId });
    const current = ensureSnapshot(session, ref, event.timestamp);
    const running = event.part.status === "pending" || event.part.status === "running";
    return commitSnapshot({
      ...current,
      activity: running ? activityForPending(current) : "idle",
      title: event.part.agent ?? event.part.description ?? current.title,
      startedAt: subagentStartedAt(event.part, current.startedAt),
      parentExternalSessionId: session.externalSessionId,
    });
  };

  const applyEvent = (
    session: ClaudeSessionContext,
    event: ClaudeAgentSdkEvent,
  ): AgentSessionLiveAdapterChange[] => {
    if (event.type === "runtime_slash_commands_changed") {
      return [
        {
          type: "slash_command_catalog_updated",
          repoPath: runtime.repoPath,
          runtimeKind: "claude",
          workingDirectory: session.input.workingDirectory,
          catalog: event.catalog,
        },
      ];
    }
    if (event.type === "session_context_error") {
      return [
        {
          type: "fault",
          repoPath: runtime.repoPath,
          operation: "claude-live-session.load-context",
          message: event.message,
        },
      ];
    }
    const ref = eventRef(session, event);
    const key = refKey(ref);
    if (retiredSessionKeys.has(refKey(rootRef(session))) || retiredSessionKeys.has(key)) {
      return [];
    }
    if (
      event.type === "approval_required" ||
      event.type === "approval_resolved" ||
      event.type === "question_required" ||
      event.type === "question_resolved"
    ) {
      return applyPendingEvent(session, event);
    }
    if (
      startupLeases.has(key) &&
      (event.type === "session_idle" ||
        (event.type === "session_status" && event.status.type === "idle"))
    ) {
      return [];
    }
    if (event.type === "user_message") {
      startupLeases.delete(key);
    }
    const snapshot = ensureSnapshot(session, ref, event.timestamp);
    const changes: AgentSessionLiveAdapterChange[] = [];
    if (event.type === "session_context_updated") {
      return commitSnapshot({
        ...snapshot,
        contextUsage: {
          totalTokens: event.totalTokens,
          ...(event.contextWindow !== undefined ? { contextWindow: event.contextWindow } : {}),
        },
      });
    }
    if (event.type === "session_status") {
      changes.push(
        ...commitSnapshot({ ...snapshot, activity: activityForStatus(event.status, snapshot) }),
      );
    } else if (event.type === "session_idle") {
      const pendingActivity = activityForPending(snapshot);
      changes.push(
        ...commitSnapshot({
          ...snapshot,
          activity: pendingActivity === "running" ? "idle" : pendingActivity,
        }),
      );
    } else if (event.type === "session_started") {
      changes.push(...commitSnapshot({ ...snapshot, activity: "running" }));
    } else if (event.type === "assistant_part") {
      changes.push(...applySubagentPart(session, event));
    }

    if (isAgentSessionTranscriptEventType(event.type)) {
      changes.push({
        type: "transcript_event",
        event: agentSessionTranscriptEventSchema.parse({ ...event, sessionRef: ref }),
      });
    }
    if (event.type === "session_finished") {
      changes.push(...removeSessionTree(rootRef(session)));
    }
    return changes;
  };

  return {
    applyEvent,
    applyLoadedContext: (
      ref: AgentSessionLiveRef,
      contextUsage: AgentSessionContextUsage | null,
    ): {
      value: AgentSessionContextUsage | null;
      changes: AgentSessionLiveAdapterChange[];
    } => {
      const snapshot = readSnapshot(ref);
      if (snapshot?.contextUsage) {
        return { value: snapshot.contextUsage, changes: [] };
      }
      if (!snapshot || !contextUsage) {
        return { value: contextUsage, changes: [] };
      }
      return {
        value: contextUsage,
        changes: commitSnapshot({ ...snapshot, contextUsage }),
      };
    },
    hasSnapshot: (ref: AgentSessionLiveRef): boolean => snapshotsByRef.has(refKey(ref)),
    listRetainedSnapshots: (repoPath: string): AgentSessionLiveSnapshot[] =>
      repoPath === runtime.repoPath ? [...snapshotsByRef.values()].map(cloneSnapshot) : [],
    matches: (ref: AgentSessionLiveRef): boolean => snapshotsByRef.has(refKey(ref)),
    readRetainedSnapshot: (ref: AgentSessionLiveRef) => {
      const snapshot = readSnapshot(ref);
      return snapshot
        ? ({ type: "live", session: cloneSnapshot(snapshot) } as const)
        : ({ type: "missing", ref } as const);
    },
    release: (): AgentSessionLiveRef[] => {
      const refs = [...snapshotsByRef.values()].map((snapshot) => snapshot.ref);
      snapshotsByRef.clear();
      retiredSessionKeys.clear();
      startupLeases.clear();
      return refs;
    },
    removeSession: removeSessionTree,
    retainControlSummary: (
      summary: AgentSessionControlSummary,
      options: { readonly forceRunning?: boolean; readonly parentExternalSessionId?: string } = {},
    ): AgentSessionLiveAdapterChange[] => {
      const ref: AgentSessionLiveRef = {
        repoPath: runtime.repoPath,
        runtimeKind: "claude",
        workingDirectory: summary.workingDirectory,
        externalSessionId: summary.externalSessionId,
      };
      const key = refKey(ref);
      retiredSessionKeys.delete(key);
      const current = readSnapshot(ref);
      if (options.forceRunning) {
        startupLeases.add(key);
      }
      return commitSnapshot({
        ref,
        activity: options.forceRunning ? "running" : activityForSummary(summary.status),
        title: summary.title ?? current?.title ?? "Claude session",
        startedAt: summary.startedAt,
        ...(options.parentExternalSessionId
          ? { parentExternalSessionId: options.parentExternalSessionId }
          : {}),
        pendingApprovals: current?.pendingApprovals ?? [],
        pendingQuestions: current?.pendingQuestions ?? [],
        contextUsage: current?.contextUsage ?? null,
      });
    },
  };
};
