import {
  type AgentSessionContextUsage,
  type AgentSessionLiveRef,
  type AgentSessionLiveSnapshot,
  agentSessionLiveSnapshotSchema,
  agentSessionTranscriptEventSchema,
  isAgentSessionTranscriptEventType,
} from "@openducktor/contracts";
import type { AgentEvent, AgentSessionSummary, AgentStreamPart } from "@openducktor/core";
import type {
  AgentSessionLiveAdapterChange,
  AgentSessionLiveAdapterMutation,
} from "../../ports/agent-session-live-adapter-port";
import type { ClaudeAgentSdkEvent, ClaudeSessionContext } from "../claude/claude-agent-sdk-types";
import { activityForSummary } from "./claude-live-session-activity";
import {
  inputActivity,
  sessionTree,
  readParent,
  toApproval,
  toQuestion,
} from "./claude-live-session-inputs";

type LoadedContextResult = AgentSessionLiveAdapterMutation<AgentSessionContextUsage | null>;
const refKey = (ref: AgentSessionLiveRef): string =>
  [ref.repoPath, ref.runtimeKind, ref.workingDirectory, ref.externalSessionId].join("\u0000");

const cloneSnapshot = (snapshot: AgentSessionLiveSnapshot): AgentSessionLiveSnapshot =>
  agentSessionLiveSnapshotSchema.parse(snapshot);

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
  part: Pick<Extract<AgentStreamPart, { kind: "subagent" }>, "startedAtMs">,
  fallback: string,
): string => {
  if (part.startedAtMs === undefined) {
    return fallback;
  }
  const startedAt = new Date(part.startedAtMs);
  return Number.isNaN(startedAt.getTime()) ? fallback : startedAt.toISOString();
};

/** Live projection of every session of one Claude runtime, across all repositories. */
export const createClaudeLiveSessionState = () => {
  const snapshotsByRef = new Map<string, AgentSessionLiveSnapshot>();
  const contextRevisionsByRef = new Map<string, number>();
  const nativeActivityByRef = new Map<string, AgentSessionLiveSnapshot["activity"]>();
  const retiredSessionKeys = new Set<string>();
  const subagentOwnersByRef = new Map<
    string,
    { readonly messageId: string; readonly parentRefKey: string }
  >();

  const readSnapshot = (ref: AgentSessionLiveRef): AgentSessionLiveSnapshot | undefined =>
    snapshotsByRef.get(refKey(ref));

  const commitSnapshot = (snapshot: AgentSessionLiveSnapshot): AgentSessionLiveAdapterChange[] => {
    const changes: AgentSessionLiveAdapterChange[] = [];
    let current: AgentSessionLiveSnapshot | undefined = snapshot;
    const visited = new Set<string>();
    while (current) {
      const key = refKey(current.ref);
      if (visited.has(key)) break;
      visited.add(key);
      const parsed = cloneSnapshot({
        ...current,
        activity: inputActivity(current, snapshotsByRef.values(), nativeActivityByRef.get(key)),
      });
      const previous = snapshotsByRef.get(key);
      snapshotsByRef.set(key, parsed);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(parsed)) {
        changes.push({ type: "session_upsert", snapshot: parsed });
      }
      current = readParent(parsed, readSnapshot);
    }
    return changes;
  };

  const ensureSnapshot = (
    session: ClaudeSessionContext,
    ref: AgentSessionLiveRef,
    timestamp: string,
  ): AgentSessionLiveSnapshot => {
    const current = readSnapshot(ref);
    if (current) {
      return current;
    }
    const isRoot = ref.externalSessionId === session.externalSessionId;
    const snapshot: AgentSessionLiveSnapshot = {
      ref,
      activity: session.activity === "idle" ? "idle" : "running",
      title: isRoot ? (session.summary.title ?? "Claude session") : "Claude subagent",
      startedAt: isRoot ? session.startedAt : timestamp,
      pendingApprovals: [],
      pendingQuestions: [],
      contextUsage: null,
    };
    if (session.summary.sessionAssociation.kind === "repository") {
      snapshot.repositoryScope = session.summary.sessionAssociation;
    }
    if (isRoot && session.foregroundTurnActive !== undefined) {
      snapshot.foregroundTurnActive = session.foregroundTurnActive;
    }
    if (!isRoot) {
      snapshot.parentExternalSessionId = session.externalSessionId;
    }
    nativeActivityByRef.set(refKey(ref), snapshot.activity);
    return snapshot;
  };

  const removeSnapshot = (ref: AgentSessionLiveRef): AgentSessionLiveAdapterChange[] => {
    const key = refKey(ref);
    retiredSessionKeys.add(key);
    contextRevisionsByRef.delete(key);
    nativeActivityByRef.delete(key);
    subagentOwnersByRef.delete(key);
    if (!snapshotsByRef.delete(key)) {
      return [];
    }
    return [{ type: "session_removed", ref }];
  };

  const removeSessionTree = (ref: AgentSessionLiveRef): AgentSessionLiveAdapterChange[] => {
    const snapshot = readSnapshot(ref);
    if (!snapshot) return removeSnapshot(ref);
    const parent = readParent(snapshot, readSnapshot);
    const changes = sessionTree(snapshot, snapshotsByRef.values()).flatMap((child) =>
      removeSnapshot(child.ref),
    );
    if (parent) changes.push(...commitSnapshot(parent));
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
    const snapshot = { ...ensureSnapshot(session, ref, event.timestamp) };
    if (event.parentExternalSessionId)
      snapshot.parentExternalSessionId = event.parentExternalSessionId;
    if (event.type === "approval_required") {
      nativeActivityByRef.set(refKey(ref), "running");
      const request = toApproval(event);
      return commitSnapshot({
        ...snapshot,
        pendingApprovals: [
          ...snapshot.pendingApprovals.filter(
            (candidate) => candidate.requestId !== request.requestId,
          ),
          request,
        ],
      });
    }
    if (event.type === "question_required") {
      if (event.blocking !== false) nativeActivityByRef.set(refKey(ref), "running");
      const request = toQuestion(event);
      return commitSnapshot({
        ...snapshot,
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
    return commitSnapshot(nextSnapshot);
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
    const previousParent = readParent(current, readSnapshot);
    nativeActivityByRef.set(refKey(ref), running ? "running" : "idle");
    const changes = commitSnapshot({
      ...current,
      pendingApprovals: running ? current.pendingApprovals : [],
      pendingQuestions: running ? current.pendingQuestions : [],
      title: event.part.agent ?? event.part.description ?? current.title,
      startedAt: subagentStartedAt(event.part, current.startedAt),
      parentExternalSessionId: event.externalSessionId,
    });
    if (previousParent && previousParent.ref.externalSessionId !== event.externalSessionId) {
      changes.push(...commitSnapshot(previousParent));
    }
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
          repoPath: session.input.repoPath,
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
      if (event.statusUnavailable) {
        const changes: AgentSessionLiveAdapterChange[] = [];
        const root = ensureSnapshot(session, rootRef(session), event.timestamp);
        const affected = sessionTree(root, snapshotsByRef.values());
        for (const snapshot of affected) {
          const unavailableSnapshot = {
            ...snapshot,
            statusUnavailableReason: event.message,
            pendingApprovals: [],
            pendingQuestions: [],
          };
          delete unavailableSnapshot.foregroundTurnActive;
          changes.push(...commitSnapshot(unavailableSnapshot), {
            type: "fault",
            repoPath: ref.repoPath,
            operation: "claude-live-session.termination",
            message: event.message,
            ref: snapshot.ref,
            statusUnavailable: true,
          });
        }
        return changes;
      }
      return [
        {
          type: "fault",
          repoPath: ref.repoPath,
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
      const contextUsage: NonNullable<AgentSessionLiveSnapshot["contextUsage"]> = {
        totalTokens: event.totalTokens,
      };
      if (event.contextWindow !== undefined) {
        contextUsage.contextWindow = event.contextWindow;
      }
      return commitSnapshot({
        ...snapshot,
        contextUsage,
      });
    }
    if (event.type === "session_policy_notice") {
      const { messageId, message, timestamp } = event;
      changes.push(
        ...commitSnapshot({ ...snapshot, policyNotice: { messageId, message, timestamp } }),
      );
    } else if (
      event.type === "transcript_retracted" &&
      snapshot.policyNotice &&
      event.messageIds.includes(snapshot.policyNotice.messageId)
    ) {
      const nextSnapshot = { ...snapshot };
      delete nextSnapshot.policyNotice;
      changes.push(...commitSnapshot(nextSnapshot));
    } else if (event.type === "session_status") {
      let activity: AgentSessionLiveSnapshot["activity"] = "idle";
      if (event.status.type === "busy") activity = "running";
      else if (event.status.type === "retry") activity = "retrying";
      nativeActivityByRef.set(key, activity);
      const next = { ...snapshot };
      delete next.statusUnavailableReason;
      if (event.foregroundTurnActive !== undefined)
        next.foregroundTurnActive = event.foregroundTurnActive;
      changes.push(...commitSnapshot(next));
    } else if (event.type === "session_idle") {
      nativeActivityByRef.set(key, "idle");
      const next = { ...snapshot, foregroundTurnActive: false };
      delete next.statusUnavailableReason;
      changes.push(...commitSnapshot(next));
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
    ) => {
      const previous = new Map(snapshotsByRef);
      const previousActivity = new Map(nativeActivityByRef);
      const changes = applyPendingEvent(session, event);
      return {
        changes,
        rollback: () => {
          for (const change of changes) {
            if (change.type !== "session_upsert") continue;
            const key = refKey(change.snapshot.ref);
            const snapshot = previous.get(key);
            if (snapshot) snapshotsByRef.set(key, snapshot);
            else snapshotsByRef.delete(key);
            const activity = previousActivity.get(key);
            if (activity) nativeActivityByRef.set(key, activity);
            else nativeActivityByRef.delete(key);
          }
        },
      } satisfies {
        changes: AgentSessionLiveAdapterChange[];
        rollback: () => void;
      };
    },
    applyLoadedContext: (
      ref: AgentSessionLiveRef,
      contextUsage: AgentSessionContextUsage | null,
      expectedRevision: number,
    ): LoadedContextResult => {
      const snapshot = readSnapshot(ref);
      if (
        (contextRevisionsByRef.get(refKey(ref)) ?? 0) !== expectedRevision ||
        !contextUsage ||
        !snapshot ||
        JSON.stringify(snapshot.contextUsage) === JSON.stringify(contextUsage)
      ) {
        return { value: snapshot?.contextUsage ?? contextUsage, changes: [] };
      }
      return {
        value: contextUsage,
        changes: commitSnapshot({ ...snapshot, contextUsage }),
      };
    },
    contextRevision: (ref: AgentSessionLiveRef): number =>
      contextRevisionsByRef.get(refKey(ref)) ?? 0,
    listSnapshots: (): AgentSessionLiveSnapshot[] =>
      [...snapshotsByRef.values()].map(cloneSnapshot),
    readSnapshot: (ref: AgentSessionLiveRef) => {
      const snapshot = readSnapshot(ref);
      return snapshot
        ? ({ type: "live", session: cloneSnapshot(snapshot) } as const)
        : ({ type: "missing", ref } as const);
    },
    release: (): AgentSessionLiveRef[] => {
      const refs = [...snapshotsByRef.values()].map((snapshot) => snapshot.ref);
      snapshotsByRef.clear();
      contextRevisionsByRef.clear();
      nativeActivityByRef.clear();
      retiredSessionKeys.clear();
      subagentOwnersByRef.clear();
      return refs;
    },
    reactivateSession: (ref: AgentSessionLiveRef): void => {
      retiredSessionKeys.delete(refKey(ref));
    },
    removeSession: removeSessionTree,
    /** Summaries carry no repository, so the caller passes the repository of the request. */
    applyControlSummary: (
      repoPath: string,
      summary: AgentSessionSummary,
      options: {
        readonly parentExternalSessionId?: string;
        readonly keepActivity?: boolean;
      } = {},
    ): AgentSessionLiveAdapterChange[] => {
      const ref: AgentSessionLiveRef = {
        repoPath,
        runtimeKind: "claude",
        workingDirectory: summary.workingDirectory,
        externalSessionId: summary.externalSessionId,
      };
      const key = refKey(ref);
      retiredSessionKeys.delete(key);
      const current = readSnapshot(ref);
      let activity = activityForSummary(summary.status);
      if (options.keepActivity && current) {
        activity = current.activity;
      } else {
        nativeActivityByRef.set(key, activity);
      }
      const nextSnapshot: AgentSessionLiveSnapshot = {
        ref,
        activity,
        title: summary.title ?? current?.title ?? "Claude session",
        startedAt: summary.startedAt,
        pendingApprovals: current?.pendingApprovals ?? [],
        pendingQuestions: current?.pendingQuestions ?? [],
        contextUsage: current?.contextUsage ?? null,
      };
      if (options.keepActivity && current) {
        if (current.foregroundTurnActive !== undefined)
          nextSnapshot.foregroundTurnActive = current.foregroundTurnActive;
        if (current.statusUnavailableReason !== undefined)
          nextSnapshot.statusUnavailableReason = current.statusUnavailableReason;
      }
      if (summary.sessionAssociation.kind === "repository") {
        nextSnapshot.repositoryScope = summary.sessionAssociation;
      }
      if (current?.policyNotice) {
        nextSnapshot.policyNotice = current.policyNotice;
      }
      if (options.parentExternalSessionId) {
        nextSnapshot.parentExternalSessionId = options.parentExternalSessionId;
      }
      return commitSnapshot(nextSnapshot);
    },
  };
};
