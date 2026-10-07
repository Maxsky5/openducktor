import type {
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
  TaskAgentSessions,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { Clock, Effect } from "effect";
import {
  type HostError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { AgentSessionPersistencePort } from "../../ports/agent-session-persistence-port";
import type { AgentSessionRepository } from "../../ports/task-repository-ports";

type ObservedSession = {
  ref: AgentSessionLiveRef;
  activity?: AgentSessionLiveSnapshot["activity"];
  parentExternalSessionId?: string | undefined;
  pending: ReadonlySet<string>;
  untimedStatusChange: boolean;
  finalMessage?: { messageId: string; at: number };
};

type WorkspacePersistence = AgentSessionPersistencePort & {
  recordActivity(ref: AgentSessionLiveRef, occurredAt: number): Effect.Effect<boolean, HostError>;
};

/** Save activity from the ordered live stream. Baselines and streamed text never write a date. */
export const createAgentSessionActivityPersistence = ({
  tasks,
  workspace,
  publishTaskRecords,
}: {
  tasks: Pick<AgentSessionRepository, "recordAgentSessionActivity">;
  workspace: WorkspacePersistence;
  publishTaskRecords(repoPath: string, records: TaskAgentSessions): Effect.Effect<void, HostError>;
}): AgentSessionPersistencePort => {
  const sessions = new Map<string, ObservedSession>();
  const record = (ref: AgentSessionLiveRef, at: number): Effect.Effect<void, HostError> =>
    Effect.gen(function* () {
      let root = ref;
      const visited = new Set<string>();
      while (true) {
        const key = agentSessionRefKey(root);
        if (visited.has(key))
          return yield* new HostValidationError({
            message: "Session parent links contain a cycle.",
            field: "parentExternalSessionId",
          });
        visited.add(key);
        const parent = sessions.get(key)?.parentExternalSessionId;
        if (!parent) break;
        root = { ...root, externalSessionId: parent };
      }
      if (yield* workspace.recordActivity(root, at)) return;
      const saved = yield* tasks
        .recordAgentSessionActivity({ repoPath: root.repoPath, identity: root, occurredAt: at })
        .pipe(
          Effect.mapError((cause) => toHostOperationError(cause, "agent-session.persist-activity")),
        );
      if (saved) yield* publishTaskRecords(root.repoPath, saved);
    });
  const flush = (ref: AgentSessionLiveRef, current: ObservedSession) =>
    Effect.gen(function* () {
      if (!current.finalMessage) return;
      yield* record(ref, current.finalMessage.at);
      delete current.finalMessage;
    });

  return {
    observe: (envelope, provenance) =>
      Effect.gen(function* () {
        yield* workspace.observe(envelope, provenance);
        if (envelope.type === "snapshot") {
          const keys = new Set(
            envelope.sessions.map((snapshot) => agentSessionRefKey(snapshot.ref)),
          );
          for (const [key, current] of sessions) {
            if (current.ref.repoPath === envelope.repoPath && !keys.has(key)) sessions.delete(key);
          }
          for (const snapshot of envelope.sessions) {
            const key = agentSessionRefKey(snapshot.ref);
            sessions.set(key, {
              ...sessions.get(key),
              ref: snapshot.ref,
              activity: snapshot.activity,
              parentExternalSessionId: snapshot.parentExternalSessionId,
              pending: pendingKeys(snapshot),
              untimedStatusChange: false,
            });
          }
          return;
        }
        if (envelope.type === "session_removed") {
          const key = agentSessionRefKey(envelope.ref);
          const current = sessions.get(key);
          if (provenance !== "baseline" && current && isActive(current))
            yield* record(envelope.ref, yield* Clock.currentTimeMillis);
          sessions.delete(key);
          return;
        }
        if (envelope.type === "session_upsert") {
          const snapshot = envelope.session;
          const key = agentSessionRefKey(snapshot.ref);
          const previous = sessions.get(key);
          const current = {
            ...previous,
            ref: snapshot.ref,
            activity: snapshot.activity,
            parentExternalSessionId: snapshot.parentExternalSessionId,
            pending: pendingKeys(snapshot),
            untimedStatusChange:
              previous !== undefined &&
              (previous.untimedStatusChange || previous.activity !== snapshot.activity),
          };
          sessions.set(key, current);
          if (provenance === "baseline") {
            current.untimedStatusChange = false;
            return;
          }
          // Pending requests arrive as snapshots without an event timestamp. Only a changed
          // request on an already observed session proves new input, never its first read.
          if (previous && [...current.pending].some((request) => !previous.pending.has(request))) {
            yield* record(snapshot.ref, yield* Clock.currentTimeMillis);
          }
          if (snapshot.activity === "idle") yield* flush(snapshot.ref, current);
          return;
        }
        if (envelope.type !== "transcript_event" || provenance === "baseline") return;
        const event = envelope.event;
        const ref = event.sessionRef;
        const key = agentSessionRefKey(ref);
        let current = sessions.get(key);
        const at = Date.parse(event.timestamp);
        if (event.type === "assistant_message") {
          current ??= { ref, pending: new Set<string>(), untimedStatusChange: false };
          if (!current.finalMessage || at > current.finalMessage.at)
            current.finalMessage = { messageId: event.messageId, at };
          sessions.set(key, current);
          return;
        }
        if (event.type === "transcript_retracted") {
          if (current?.finalMessage && event.messageIds.includes(current.finalMessage.messageId))
            delete current.finalMessage;
          return;
        }
        switch (event.type) {
          case "user_message":
          case "session_started":
          case "image_generation_turn_started":
            yield* record(ref, at);
            current ??= { ref, pending: new Set<string>(), untimedStatusChange: false };
            current.activity = "running";
            current.untimedStatusChange = false;
            sessions.set(key, current);
            return;
          case "turn_error":
          case "session_error":
            yield* record(ref, at);
            if (current) current.untimedStatusChange = false;
            return;
          case "session_finished":
            // Native runtimes also finish idle connections during cleanup.
            if (current && (isActive(current) || current.untimedStatusChange))
              yield* record(ref, at);
            if (current) {
              yield* flush(ref, current);
              current.untimedStatusChange = false;
              current.activity = "idle";
            }
            return;
          case "session_idle":
            if (
              event.turnCompleted ||
              current?.untimedStatusChange ||
              (current && current.activity !== undefined && current.activity !== "idle")
            )
              yield* record(ref, at);
            if (current) {
              yield* flush(ref, current);
              current.untimedStatusChange = false;
              current.activity = "idle";
            }
            return;
          case "session_status": {
            const activity =
              event.status.type === "idle"
                ? "idle"
                : event.status.type === "retry"
                  ? "retrying"
                  : "running";
            if (current && (current.untimedStatusChange || current.activity !== activity))
              yield* record(ref, at);
            if (current) {
              if (event.status.type === "idle") yield* flush(ref, current);
              current.untimedStatusChange = false;
              current.activity = activity;
            }
          }
        }
      }),
  };
};

const pendingKeys = (snapshot: AgentSessionLiveSnapshot): ReadonlySet<string> =>
  new Set([
    ...snapshot.pendingApprovals.map((request) =>
      JSON.stringify(["permission", request.requestId]),
    ),
    ...snapshot.pendingQuestions.map((request) =>
      JSON.stringify(["question", request.requestId, request.requestInstanceId]),
    ),
  ]);

const isActive = (session: ObservedSession): boolean =>
  session.activity !== undefined && session.activity !== "idle";
