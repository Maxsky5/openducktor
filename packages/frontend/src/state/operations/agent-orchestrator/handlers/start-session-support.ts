import type { SessionStartTags, StartedSessionContext } from "./start-session.types";

export const compareBySessionRecency = (
  a: { startedAt: string; externalSessionId: string },
  b: { startedAt: string; externalSessionId: string },
): number => {
  if (a.startedAt !== b.startedAt) {
    return a.startedAt > b.startedAt ? -1 : 1;
  }
  if (a.externalSessionId === b.externalSessionId) {
    return 0;
  }
  return a.externalSessionId > b.externalSessionId ? -1 : 1;
};

export const pickLatestSession = <T extends { startedAt: string; externalSessionId: string }>(
  sessions: T[],
): T | undefined => {
  const first = sessions[0];
  if (!first) {
    return undefined;
  }

  let latest = first;
  for (let index = 1; index < sessions.length; index++) {
    const current = sessions[index];
    if (current && compareBySessionRecency(current, latest) < 0) {
      latest = current;
    }
  }

  return latest;
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
  externalSessionId: summary.externalSessionId,
});
