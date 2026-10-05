import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { Effect } from "effect";
import type {
  AgentSessionLiveAdapterPort,
  AgentSessionLiveRegistration,
  AgentSessionRuntimeAdapterPort,
} from "../../ports/agent-session-live-adapter-port";

const hasLiveWork = (snapshot: AgentSessionLiveSnapshot): boolean =>
  snapshot.activity !== "idle" ||
  snapshot.pendingApprovals.length > 0 ||
  snapshot.pendingQuestions.length > 0;

/**
 * Records the sessions that each runtime generation served through a session control. A runtime
 * can also hold idle sessions that it only restored from saved history for display. Those are
 * history, so a lifecycle action does not list them as affected.
 */
export const createRuntimeSessionEngagement = () => {
  const engaged = new WeakMap<AgentSessionLiveRegistration, Set<string>>();
  const engage = (registration: AgentSessionLiveRegistration, externalSessionId: string) =>
    Effect.sync(() => {
      const sessions = engaged.get(registration) ?? new Set<string>();
      sessions.add(externalSessionId);
      engaged.set(registration, sessions);
    });

  return {
    /** Records each session that a start, resume, continuation, fork, or send serves. */
    trackControls: (adapter: AgentSessionRuntimeAdapterPort): AgentSessionRuntimeAdapterPort => ({
      ...adapter,
      startSession: (input) =>
        adapter
          .startSession(input)
          .pipe(Effect.tap((summary) => engage(adapter.binding, summary.externalSessionId))),
      resumeSession: (input) =>
        adapter
          .resumeSession(input)
          .pipe(Effect.tap(() => engage(adapter.binding, input.externalSessionId))),
      continueInterruptedTurn: (input) =>
        adapter
          .continueInterruptedTurn(input)
          .pipe(Effect.tap(() => engage(adapter.binding, input.externalSessionId))),
      forkSession: (input) =>
        adapter
          .forkSession(input)
          .pipe(Effect.tap((summary) => engage(adapter.binding, summary.externalSessionId))),
      sendUserMessage: (input) =>
        adapter
          .sendUserMessage(input)
          .pipe(Effect.tap(() => engage(adapter.binding, input.externalSessionId))),
    }),
    /** Records each session that an approval or question reply serves. */
    trackReplies: (adapter: AgentSessionLiveAdapterPort): AgentSessionLiveAdapterPort => ({
      ...adapter,
      replyApproval: (input) =>
        adapter
          .replyApproval(input)
          .pipe(Effect.tap(() => engage(adapter.binding, input.externalSessionId))),
      replyQuestion: (input) =>
        adapter
          .replyQuestion(input)
          .pipe(Effect.tap(() => engage(adapter.binding, input.externalSessionId))),
    }),
    /**
     * Keeps the sessions that a lifecycle action of this generation stops or detaches: each
     * session with live work, and each session of a tree that a control served.
     */
    affected: (
      registration: AgentSessionLiveRegistration,
      snapshots: ReadonlyArray<AgentSessionLiveSnapshot>,
    ): AgentSessionLiveSnapshot[] => {
      const sessions = engaged.get(registration);
      const parents = new Map(
        snapshots.map((snapshot) => [
          snapshot.ref.externalSessionId,
          snapshot.parentExternalSessionId,
        ]),
      );
      const isServed = (externalSessionId: string): boolean => {
        const visited = new Set<string>();
        let current: string | undefined = externalSessionId;
        while (current !== undefined && !visited.has(current)) {
          if (sessions?.has(current)) return true;
          visited.add(current);
          current = parents.get(current);
        }
        return false;
      };
      return snapshots.filter(
        (snapshot) => hasLiveWork(snapshot) || isServed(snapshot.ref.externalSessionId),
      );
    },
  };
};
