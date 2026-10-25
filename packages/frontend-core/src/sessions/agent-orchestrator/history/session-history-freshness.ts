import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import {
  type AgentSessionCollection,
  listAgentSessions,
  replaceAgentSession,
} from "../../agent-session-collection";
import type { AgentSessionState } from "../../../types/agent-orchestrator";

/** Keep the transcript baseline when its live coverage fails. A new history read must follow. */
export const markSessionHistoryStale = (session: AgentSessionState): AgentSessionState => {
  if (
    session.historyLoadState === "loaded" ||
    session.historyLoadState === "unverified" ||
    session.historyLoadState === "refreshing"
  ) {
    return { ...session, historyLoadState: "stale" };
  }
  return session.historyLoadState === "loading"
    ? { ...session, historyLoadState: "not_requested" }
    : session;
};

export const markSessionHistoriesStale = (
  collection: AgentSessionCollection,
): AgentSessionCollection => {
  let next = collection;
  for (const session of listAgentSessions(collection)) {
    next = replaceAgentSession(next, markSessionHistoryStale(session));
  }
  return next;
};

/**
 * Keep the transcript baseline when live coverage ends, as after a replay gap. The next live
 * snapshot settles a loaded transcript with `settleUnverifiedSessionHistory`. A read in flight
 * stops, so its session needs a new read.
 */
export const markSessionHistoryUnverified = (session: AgentSessionState): AgentSessionState =>
  session.historyLoadState === "loaded"
    ? { ...session, historyLoadState: "unverified" }
    : markSessionHistoryStale(session);

export const markSessionHistoriesUnverified = (
  collection: AgentSessionCollection,
): AgentSessionCollection => {
  let next = collection;
  for (const session of listAgentSessions(collection)) {
    next = replaceAgentSession(next, markSessionHistoryUnverified(session));
  }
  return next;
};

const pendingRequestKey = (input: {
  pendingApprovals: readonly { requestId: string }[];
  pendingQuestions: readonly { requestId: string }[];
}): string =>
  [...input.pendingApprovals, ...input.pendingQuestions]
    .map((request) => request.requestId)
    .sort()
    .join("\n");

/**
 * True when the session can have messages that its transcript does not show. The host gives a
 * session a new execution episode each time it starts to work. So a session that did not work
 * when live coverage ended, does not work now, and keeps its episode and its pending input has
 * the same messages.
 */
const canHaveMissedMessages = (
  session: AgentSessionState,
  snapshot: AgentSessionLiveSnapshot | undefined,
): boolean => {
  const workedAtGap = session.status === "starting" || session.status === "running";
  if (!snapshot) return workedAtGap;
  if (snapshot.executionEpisodeId !== session.executionEpisodeId) return true;
  if (!workedAtGap && snapshot.activity === "idle") return false;
  // A session that still waits for the same input did not continue.
  const waits =
    snapshot.activity === "waiting_for_question" || snapshot.activity === "waiting_for_permission";
  const pending = pendingRequestKey(session);
  return !(waits && pending !== "" && pending === pendingRequestKey(snapshot));
};

/** Settles an unverified transcript with the live snapshot of its session, or its absence. */
export const settleUnverifiedSessionHistory = (
  session: AgentSessionState,
  snapshot: AgentSessionLiveSnapshot | undefined,
): AgentSessionState => {
  if (session.historyLoadState !== "unverified") return session;
  return {
    ...session,
    historyLoadState: canHaveMissedMessages(session, snapshot) ? "stale" : "loaded",
  };
};
