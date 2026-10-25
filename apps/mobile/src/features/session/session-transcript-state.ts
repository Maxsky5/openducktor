import {
  getAgentSessionActivityStateFromSession,
  isAgentSessionActivityWorking,
} from "@openducktor/frontend-core/lib/agent-session-activity-state";
import type { RuntimeReadinessState } from "@openducktor/frontend-core/lib/runtime-readiness";
import {
  type AgentSessionTranscriptState,
  deriveLoadedAgentSessionTranscriptState,
  derivePendingSelectedSessionTranscriptState,
  isAgentSessionTranscriptLoading,
} from "@openducktor/frontend-core/sessions/agent-orchestrator/transcript/session-transcript-state";
import type { AgentSessionState } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { AgentSessionReadModelLoadState } from "@openducktor/frontend-core/types/agent-session-read-model";

/**
 * The transcript state of a live session: its loaded history, the reason it is not loaded yet,
 * or the fault of its target. The history loads only while the read model is ready, so a failed
 * read model ends the wait with its failure instead of an endless load. While the app resumes
 * without a live connection, a session that worked when the connection closed misses messages. Its
 * transcript shows the loader until the reconnect delivers them or makes the transcript stale.
 */
export const deriveLiveTranscriptState = ({
  session,
  faultMessage,
  readModelLoadState,
  runtimeReadinessState,
  resuming,
}: {
  session: AgentSessionState | null;
  faultMessage: string | null;
  readModelLoadState: AgentSessionReadModelLoadState;
  runtimeReadinessState: RuntimeReadinessState;
  resuming: boolean;
}): AgentSessionTranscriptState => {
  if (session) {
    if (
      resuming &&
      isAgentSessionActivityWorking(getAgentSessionActivityStateFromSession(session))
    ) {
      return { kind: "session_loading", reason: "history" };
    }
    const loaded = deriveLoadedAgentSessionTranscriptState({ session, runtimeReadinessState });
    if (readModelLoadState.kind !== "failed" || !isAgentSessionTranscriptLoading(loaded)) {
      return loaded;
    }
    return derivePendingSelectedSessionTranscriptState({
      readModelLoadState,
      runtimeReadinessState,
    });
  }
  if (faultMessage) return { kind: "failed", message: faultMessage };
  return derivePendingSelectedSessionTranscriptState({ readModelLoadState, runtimeReadinessState });
};

const EMPTY_COUNTS: Readonly<Record<string, number>> = Object.freeze({});

/** Adds the pending approvals and questions of each Subagent session. */
export const mergePendingCounts = (
  approvals: Readonly<Record<string, number>>,
  questions: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> => {
  const keys = new Set([...Object.keys(approvals), ...Object.keys(questions)]);
  if (keys.size === 0) return EMPTY_COUNTS;
  return Object.fromEntries(
    Array.from(keys, (key) => [key, (approvals[key] ?? 0) + (questions[key] ?? 0)]),
  );
};
