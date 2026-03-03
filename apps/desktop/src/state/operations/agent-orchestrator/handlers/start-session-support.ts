import type { SessionStartTags, StartedSessionContext } from "./start-session.types";

export const compareBySessionRecency = (
  a: { startedAt: string; sessionId: string },
  b: { startedAt: string; sessionId: string },
): number => {
  if (a.startedAt !== b.startedAt) {
    return a.startedAt > b.startedAt ? -1 : 1;
  }
  if (a.sessionId === b.sessionId) {
    return 0;
  }
  return a.sessionId > b.sessionId ? -1 : 1;
};

export const pickLatestSession = <T extends { startedAt: string; sessionId: string }>(
  sessions: T[],
): T | undefined => {
  return [...sessions].sort(compareBySessionRecency)[0];
};

export const createSessionStartTags = ({
  repoPath,
  taskId,
  role,
  resolvedScenario,
  summary,
}: StartedSessionContext): SessionStartTags => ({
  repoPath,
  taskId,
  role,
  scenario: resolvedScenario,
  sessionId: summary.sessionId,
});
