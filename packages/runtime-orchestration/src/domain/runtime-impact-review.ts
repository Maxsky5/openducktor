import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";

const MAX_REVIEWS = 64;

/** The live work and runtime generations a user reviewed before a lifecycle action. */
export type ReviewedRuntimeImpact = {
  readonly actionKey: string;
  readonly runtimeIds: ReadonlyMap<string, string | null>;
  /** The work of each session the user saw: its running turn and its pending input. */
  readonly sessions: ReadonlyMap<string, ReviewedSessionWork>;
};

/**
 * Single-use confirmations. A confirmation stays valid while the current impact adds no
 * session, no new turn or pending input, and no runtime replacement.
 */
export const createRuntimeImpactConfirmations = () => {
  const reviews = new Map<string, ReviewedRuntimeImpact>();
  return {
    issue(review: ReviewedRuntimeImpact): string {
      const token = crypto.randomUUID();
      reviews.set(token, review);
      while (reviews.size > MAX_REVIEWS) {
        const oldest = reviews.keys().next().value;
        if (oldest === undefined) break;
        reviews.delete(oldest);
      }
      return token;
    },
    accept(token: string | undefined, current: ReviewedRuntimeImpact): boolean {
      if (token === undefined) return false;
      const reviewed = reviews.get(token);
      reviews.delete(token);
      if (!reviewed || reviewed.actionKey !== current.actionKey) return false;
      if (reviewed.runtimeIds.size !== current.runtimeIds.size) return false;
      for (const [kind, runtimeId] of current.runtimeIds) {
        if (reviewed.runtimeIds.get(kind) !== runtimeId) return false;
      }
      for (const [key, work] of current.sessions) {
        const reviewedWork = reviewed.sessions.get(key);
        if (!reviewedWork || !withinReview(work, reviewedWork)) return false;
      }
      return true;
    },
  };
};

export const reviewImpact = (
  actionKey: string,
  runtimeIds: ReadonlyMap<string, string | null>,
  snapshots: ReadonlyArray<AgentSessionLiveSnapshot>,
): ReviewedRuntimeImpact => ({
  actionKey,
  runtimeIds,
  sessions: new Map(
    snapshots.map((snapshot) => [agentSessionRefKey(snapshot.ref), sessionWork(snapshot)]),
  ),
});

/**
 * The fields of one live session that a lifecycle review shows and binds its confirmation to.
 * The impact rows, the confirmation, and the impact change signal all read this projection.
 */
export type ReviewedSession = {
  readonly title: string;
  readonly activity: AgentSessionLiveSnapshot["activity"];
  readonly executionEpisodeId: string | null;
  readonly parentExternalSessionId: string | null;
  readonly pendingRequestIds: ReadonlyArray<string>;
};

export const reviewedSession = (snapshot: AgentSessionLiveSnapshot): ReviewedSession => ({
  title: snapshot.title,
  activity: snapshot.activity,
  executionEpisodeId: snapshot.executionEpisodeId ?? null,
  parentExternalSessionId: snapshot.parentExternalSessionId ?? null,
  pendingRequestIds: [
    ...snapshot.pendingApprovals.map((request) => request.requestId),
    ...snapshot.pendingQuestions.map((request) => request.requestId),
  ],
});

type ReviewedSessionWork = {
  readonly running: boolean;
  readonly executionEpisodeId: string | null;
  readonly pendingRequestIds: ReadonlySet<string>;
};

const sessionWork = (snapshot: AgentSessionLiveSnapshot): ReviewedSessionWork => {
  const session = reviewedSession(snapshot);
  return {
    running: session.activity !== "idle",
    executionEpisodeId: session.executionEpisodeId,
    pendingRequestIds: new Set(session.pendingRequestIds),
  };
};

/**
 * Current work stays within the review when it is the same running turn and asks for no new
 * input. Progress, transcript text, and finished work need no new review.
 */
const withinReview = (current: ReviewedSessionWork, reviewed: ReviewedSessionWork): boolean => {
  if (current.running) {
    if (!reviewed.running) return false;
    if (current.executionEpisodeId !== reviewed.executionEpisodeId) return false;
  }
  for (const requestId of current.pendingRequestIds) {
    if (!reviewed.pendingRequestIds.has(requestId)) return false;
  }
  return true;
};
