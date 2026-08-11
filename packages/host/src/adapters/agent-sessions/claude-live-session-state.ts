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
import { isClaudeSubagentTranscriptTarget } from "../claude/claude-agent-sdk-subagent-transcripts";
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
  const contextRevisionsByRef = new Map<string, number>();
  const retiredSessionKeys = new Set<string>();
  const subagentOwnersByRef = new Map<
    string,
    { readonly messageId: string; readonly parentRefKey: string }
  >();

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
      sessionAssociation: session.summary.sessionAssociation,
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
    contextRevisionsByRef.delete(key);
    subagentOwnersByRef.delete(key);
    if (!snapshotsByRef.delete(key)) {
      return [];
    }
    return [{ type: "session_removed", ref }];
  };

  const removeSessionTree = (ref: AgentSessionLiveRef): AgentSessionLiveAdapterChange[] => {
    const refs = [ref];
    const queuedKeys = new Set([refKey(ref)]);
    for (let index = 0; index < refs.length; index += 1) {
      const parent = refs[index];
      if (!parent) {
        continue;
      }
      for (const snapshot of snapshotsByRef.values()) {
        const key = refKey(snapshot.ref);
        if (
          !queuedKeys.has(key) &&
          snapshot.ref.repoPath === parent.repoPath &&
          snapshot.ref.runtimeKind === parent.runtimeKind &&
          snapshot.parentExternalSessionId === parent.externalSessionId &&
          isClaudeSubagentTranscriptTarget(snapshot.ref.externalSessionId)
        ) {
          queuedKeys.add(key);
          refs.push(snapshot.ref);
        }
      }
    }
    return refs.flatMap(removeSnapshot);
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
    const changes = commitSnapshot({
      ...current,
      activity: running ? activityForPending(current) : "idle",
      title: event.part.agent ?? event.part.description ?? current.title,
      startedAt: subagentStartedAt(event.part, current.startedAt),
      parentExternalSessionId: event.externalSessionId,
    });
    subagentOwnersByRef.set(refKey(ref), {
      messageId: event.part.messageId,
      parentRefKey: refKey(eventRef(session, event)),
    });
    return changes;
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
    const ref = eventRef(session, event);
    const key = refKey(ref);
    if (retiredSessionKeys.has(refKey(rootRef(session))) || retiredSessionKeys.has(key)) {
      return [];
    }
    if (event.type === "session_context_error") {
      return [
        {
          type: "fault",
          repoPath: runtime.repoPath,
          operation: "claude-live-session.load-context",
          message: event.message,
          ref,
        },
      ];
    }
    if (
      event.type === "approval_required" ||
      event.type === "approval_resolved" ||
      event.type === "question_required" ||
      event.type === "question_resolved"
    ) {
      return applyPendingEvent(session, event);
    }
    const snapshot = ensureSnapshot(session, ref, event.timestamp);
    const changes: AgentSessionLiveAdapterChange[] = [];
    if (event.type === "session_context_updated") {
      contextRevisionsByRef.set(key, (contextRevisionsByRef.get(key) ?? 0) + 1);
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
    } else if (event.type === "assistant_part") {
      changes.push(...applySubagentPart(session, event));
    }

    if (isAgentSessionTranscriptEventType(event.type)) {
      changes.push({
        type: "transcript_event",
        event: agentSessionTranscriptEventSchema.parse({ ...event, sessionRef: ref }),
      });
    }
    if (event.type === "transcript_retracted") {
      const messageIds = new Set(event.messageIds);
      for (const [childRefKey, owner] of subagentOwnersByRef) {
        if (owner.parentRefKey !== key || !messageIds.has(owner.messageId)) {
          continue;
        }
        const childSnapshot = snapshotsByRef.get(childRefKey);
        if (childSnapshot) {
          changes.push(...removeSessionTree(childSnapshot.ref));
        } else {
          subagentOwnersByRef.delete(childRefKey);
        }
      }
    }
    if (event.type === "session_finished") {
      changes.push(...removeSessionTree(rootRef(session)));
    }
    return changes;
  };

  return {
    applyEvent,
    applyPendingResolution: (
      session: ClaudeSessionContext,
      event: Extract<AgentEvent, { type: "approval_resolved" | "question_resolved" }>,
    ): {
      changes: AgentSessionLiveAdapterChange[];
      rollback: () => void;
    } => {
      const ref = eventRef(session, event);
      const key = refKey(ref);
      const previous = readSnapshot(ref);
      const changes = applyPendingEvent(session, event);
      return {
        changes,
        rollback: () => {
          if (previous) {
            snapshotsByRef.set(key, previous);
          } else {
            snapshotsByRef.delete(key);
          }
        },
      };
    },
    applyLoadedContext: (
      ref: AgentSessionLiveRef,
      contextUsage: AgentSessionContextUsage | null,
      expectedRevision: number,
    ): {
      value: AgentSessionContextUsage | null;
      changes: AgentSessionLiveAdapterChange[];
    } => {
      const snapshot = readSnapshot(ref);
      if ((contextRevisionsByRef.get(refKey(ref)) ?? 0) !== expectedRevision) {
        return { value: snapshot?.contextUsage ?? contextUsage, changes: [] };
      }
      if (!contextUsage) {
        return { value: snapshot?.contextUsage ?? null, changes: [] };
      }
      if (!snapshot) {
        return { value: contextUsage, changes: [] };
      }
      if (JSON.stringify(snapshot.contextUsage) === JSON.stringify(contextUsage)) {
        return { value: snapshot.contextUsage, changes: [] };
      }
      return {
        value: contextUsage,
        changes: commitSnapshot({ ...snapshot, contextUsage }),
      };
    },
    contextRevision: (ref: AgentSessionLiveRef): number =>
      contextRevisionsByRef.get(refKey(ref)) ?? 0,
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
      contextRevisionsByRef.clear();
      retiredSessionKeys.clear();
      subagentOwnersByRef.clear();
      return refs;
    },
    reactivateSession: (ref: AgentSessionLiveRef): void => {
      retiredSessionKeys.delete(refKey(ref));
    },
    removeSession: removeSessionTree,
    retainControlSummary: (
      summary: AgentSessionControlSummary,
      options: {
        readonly parentExternalSessionId?: string;
        readonly preserveRetainedActivity?: boolean;
      } = {},
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
      let activity = activityForSummary(summary.status);
      if (options.preserveRetainedActivity && current) {
        activity = current.activity;
      }
      return commitSnapshot({
        ref,
        sessionAssociation: summary.sessionAssociation,
        activity,
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
