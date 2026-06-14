import type { AgentSessionRecord } from "@openducktor/contracts";
import { appQueryClient } from "@/lib/query-client";
import {
  getAgentSessionByExternalSessionId,
  listAgentSessions,
} from "@/state/agent-session-collection";
import { agentSessionListQueryOptions } from "@/state/queries/agent-sessions";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { normalizeWorkingDirectory, throwIfRepoStale } from "../support/core";
import type {
  StartOrReuseResult,
  StartSessionContext,
  StartSessionCreationInput,
  StartSessionExecutionDependencies,
} from "./start-session.types";
import { requireBuildContinuationTarget, STALE_START_ERROR } from "./start-session-constants";
import { resolveReuseValidationError, resolveStartTask } from "./start-session-policies";

type ReuseStrategyInput = {
  ctx: StartSessionContext;
  input: Extract<StartSessionCreationInput, { startMode: "reuse" }>;
  deps: StartSessionExecutionDependencies;
};

const loadPersistedSessionsForRole = async ({
  ctx,
}: Pick<ReuseStrategyInput, "ctx">): Promise<AgentSessionRecord[]> => {
  const persistedSessions = await appQueryClient.fetchQuery({
    ...agentSessionListQueryOptions(ctx.repoPath, ctx.taskId),
  });
  return persistedSessions.filter((entry) => entry.role === ctx.role);
};

const loadSessionForReuse = async ({
  ctx,
  deps,
  externalSessionId,
  mode,
  forceReload = false,
}: {
  ctx: StartSessionContext;
  deps: StartSessionExecutionDependencies;
  externalSessionId: string;
  mode: "reuse" | "fork";
  forceReload?: boolean;
}): Promise<AgentSessionState> => {
  const currentSession = getAgentSessionByExternalSessionId(
    deps.session.sessionsRef.current,
    externalSessionId,
  );
  if (forceReload || !currentSession) {
    await deps.session.loadAgentSessions(ctx.taskId, {
      targetExternalSessionId: externalSessionId,
    });
    throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);
  }

  const loadedSession = getAgentSessionByExternalSessionId(
    deps.session.sessionsRef.current,
    externalSessionId,
  );
  if (!loadedSession) {
    throw new Error(
      `Failed to load session "${externalSessionId}" for ${mode === "reuse" ? "reuse" : "forking"}.`,
    );
  }

  return loadedSession;
};

const createWorkingDirectoryMatchers = ({
  ctx,
  deps,
}: Pick<ReuseStrategyInput, "ctx" | "deps">) => {
  let resolvedExpectedWorkingDirectory: string | null = null;

  const resolveExpectedWorkingDirectory = async (): Promise<string> => {
    if (resolvedExpectedWorkingDirectory !== null) {
      return resolvedExpectedWorkingDirectory;
    }

    resolvedExpectedWorkingDirectory = normalizeWorkingDirectory(
      requireBuildContinuationTarget(
        await deps.runtime.resolveTaskWorktree(ctx.repoPath, ctx.taskId),
      ).workingDirectory,
    );
    return resolvedExpectedWorkingDirectory;
  };

  const matchesQaTarget = async (workingDirectory: string): Promise<boolean> => {
    if (ctx.role !== "qa") {
      return true;
    }
    return (
      normalizeWorkingDirectory(workingDirectory) === (await resolveExpectedWorkingDirectory())
    );
  };

  const matchesBuildTarget = async (workingDirectory: string): Promise<boolean> => {
    if (ctx.role !== "build") {
      return true;
    }
    try {
      return (
        normalizeWorkingDirectory(workingDirectory) === (await resolveExpectedWorkingDirectory())
      );
    } catch {
      return false;
    }
  };

  return {
    matchesQaTarget,
    matchesBuildTarget,
  };
};

const validateReusableSession = async ({
  session,
  matchesQaTarget,
  matchesBuildTarget,
}: {
  session: Pick<AgentSessionState, "workingDirectory">;
  matchesQaTarget: (workingDirectory: string) => Promise<boolean>;
  matchesBuildTarget: (workingDirectory: string) => Promise<boolean>;
}): Promise<string | null> => {
  const [matchesQa, matchesBuild] = await Promise.all([
    matchesQaTarget(session.workingDirectory),
    matchesBuildTarget(session.workingDirectory),
  ]);
  const reuseError = resolveReuseValidationError({
    matchesQaTarget: matchesQa,
    matchesBuildTarget: matchesBuild,
  });

  return reuseError;
};

export const resolveLoadedSourceSession = async ({
  ctx,
  deps,
  sourceExternalSessionId,
}: {
  ctx: StartSessionContext;
  deps: StartSessionExecutionDependencies;
  sourceExternalSessionId: string;
}): Promise<AgentSessionState> => {
  const existingSourceSession = listAgentSessions(deps.session.sessionsRef.current).find(
    (entry) =>
      entry.taskId === ctx.taskId &&
      entry.role === ctx.role &&
      entry.externalSessionId === sourceExternalSessionId,
  );
  if (existingSourceSession) {
    if (existingSourceSession.historyLoadState !== "loaded") {
      return loadSessionForReuse({
        ctx,
        deps,
        externalSessionId: existingSourceSession.externalSessionId,
        mode: "fork",
        forceReload: true,
      });
    }
    return existingSourceSession;
  }

  const persistedSourceSession = (await loadPersistedSessionsForRole({ ctx })).find(
    (entry) => entry.externalSessionId === sourceExternalSessionId,
  );
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  if (!persistedSourceSession) {
    throw new Error(
      `Session "${sourceExternalSessionId}" is not available for task "${ctx.taskId}" and role "${ctx.role}".`,
    );
  }

  return loadSessionForReuse({
    ctx,
    deps,
    externalSessionId: persistedSourceSession.externalSessionId,
    mode: "fork",
  });
};

export const executeReuseStart = async ({
  ctx,
  input,
  deps,
}: ReuseStrategyInput): Promise<Extract<StartOrReuseResult, { kind: "reused" }>> => {
  if (ctx.role === "qa") {
    resolveStartTask({ ctx, task: deps.task });
  }
  const { matchesQaTarget, matchesBuildTarget } = createWorkingDirectoryMatchers({ ctx, deps });

  const existingSession = listAgentSessions(deps.session.sessionsRef.current).find(
    (entry) =>
      entry.taskId === ctx.taskId &&
      entry.role === ctx.role &&
      entry.externalSessionId === input.sourceExternalSessionId,
  );
  if (existingSession) {
    const reuseError = await validateReusableSession({
      session: existingSession,
      matchesQaTarget,
      matchesBuildTarget,
    });
    if (!reuseError) {
      return {
        kind: "reused",
        session: existingSession,
      };
    }
    throw new Error(
      `Session "${input.sourceExternalSessionId}" cannot be reused because ${reuseError}.`,
    );
  }

  const persistedSession = (await loadPersistedSessionsForRole({ ctx })).find(
    (entry) => entry.externalSessionId === input.sourceExternalSessionId,
  );
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  if (!persistedSession) {
    throw new Error(
      `Session "${input.sourceExternalSessionId}" is not available for task "${ctx.taskId}" and role "${ctx.role}".`,
    );
  }

  const reuseError = await validateReusableSession({
    session: persistedSession,
    matchesQaTarget,
    matchesBuildTarget,
  });
  if (reuseError) {
    throw new Error(
      `Session "${input.sourceExternalSessionId}" cannot be reused because ${reuseError}.`,
    );
  }

  const loadedSession = await loadSessionForReuse({
    ctx,
    deps,
    externalSessionId: persistedSession.externalSessionId,
    mode: "reuse",
  });

  return {
    kind: "reused",
    session: loadedSession,
  };
};
