import type { AgentSessionRecord } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { appQueryClient } from "@/lib/query-client";
import { getAgentSession } from "@/state/agent-session-collection";
import { agentSessionListQueryOptions } from "@/state/queries/agent-sessions";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
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
  sourceSession,
  mode,
  forceReload = false,
}: {
  ctx: StartSessionContext;
  deps: StartSessionExecutionDependencies;
  sourceSession: AgentSessionIdentity;
  mode: "reuse" | "fork";
  forceReload?: boolean;
}): Promise<AgentSessionState> => {
  const currentSession = getAgentSession(deps.session.sessionsRef.current, sourceSession);
  if (forceReload || !currentSession) {
    await deps.session.loadAgentSessions(ctx.taskId, {
      historyTargetSession: sourceSession,
    });
    throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);
  }

  const loadedSession = getAgentSession(deps.session.sessionsRef.current, sourceSession);
  if (!loadedSession) {
    throw new Error(
      `Failed to load session "${sourceSession.externalSessionId}" for ${mode === "reuse" ? "reuse" : "forking"}.`,
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

const matchesSourceIdentity = (
  session: Pick<
    AgentSessionState | AgentSessionRecord,
    "externalSessionId" | "runtimeKind" | "workingDirectory"
  >,
  sourceSession: AgentSessionIdentity,
): boolean => agentSessionIdentityKey(session) === agentSessionIdentityKey(sourceSession);

const matchesLoadedSourceSession = (
  session: Pick<
    AgentSessionState,
    "externalSessionId" | "runtimeKind" | "workingDirectory" | "taskId" | "role"
  >,
  ctx: StartSessionContext,
  sourceSession: AgentSessionIdentity,
): boolean =>
  session.taskId === ctx.taskId &&
  session.role === ctx.role &&
  matchesSourceIdentity(session, sourceSession);

const matchesPersistedSourceSession = (
  session: Pick<
    AgentSessionRecord,
    "externalSessionId" | "runtimeKind" | "workingDirectory" | "role"
  >,
  ctx: StartSessionContext,
  sourceSession: AgentSessionIdentity,
): boolean => session.role === ctx.role && matchesSourceIdentity(session, sourceSession);

export const resolveLoadedSourceSession = async ({
  ctx,
  deps,
  sourceSession,
}: {
  ctx: StartSessionContext;
  deps: StartSessionExecutionDependencies;
  sourceSession: AgentSessionIdentity;
}): Promise<AgentSessionState> => {
  const existingSourceSession = getAgentSession(deps.session.sessionsRef.current, sourceSession);
  if (existingSourceSession) {
    if (!matchesLoadedSourceSession(existingSourceSession, ctx, sourceSession)) {
      throw new Error(
        `Session "${sourceSession.externalSessionId}" is not available for task "${ctx.taskId}" and role "${ctx.role}".`,
      );
    }
    if (existingSourceSession.historyLoadState !== "loaded") {
      return loadSessionForReuse({
        ctx,
        deps,
        sourceSession,
        mode: "fork",
        forceReload: true,
      });
    }
    return existingSourceSession;
  }

  const persistedSourceSession = (await loadPersistedSessionsForRole({ ctx })).find((entry) =>
    matchesPersistedSourceSession(entry, ctx, sourceSession),
  );
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  if (!persistedSourceSession) {
    throw new Error(
      `Session "${sourceSession.externalSessionId}" is not available for task "${ctx.taskId}" and role "${ctx.role}".`,
    );
  }

  return loadSessionForReuse({
    ctx,
    deps,
    sourceSession,
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

  const existingSession = getAgentSession(deps.session.sessionsRef.current, input.sourceSession);
  if (existingSession) {
    if (!matchesLoadedSourceSession(existingSession, ctx, input.sourceSession)) {
      throw new Error(
        `Session "${input.sourceSession.externalSessionId}" is not available for task "${ctx.taskId}" and role "${ctx.role}".`,
      );
    }
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
      `Session "${input.sourceSession.externalSessionId}" cannot be reused because ${reuseError}.`,
    );
  }

  const persistedSession = (await loadPersistedSessionsForRole({ ctx })).find((entry) =>
    matchesPersistedSourceSession(entry, ctx, input.sourceSession),
  );
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  if (!persistedSession) {
    throw new Error(
      `Session "${input.sourceSession.externalSessionId}" is not available for task "${ctx.taskId}" and role "${ctx.role}".`,
    );
  }

  const reuseError = await validateReusableSession({
    session: persistedSession,
    matchesQaTarget,
    matchesBuildTarget,
  });
  if (reuseError) {
    throw new Error(
      `Session "${input.sourceSession.externalSessionId}" cannot be reused because ${reuseError}.`,
    );
  }

  const loadedSession = await loadSessionForReuse({
    ctx,
    deps,
    sourceSession: input.sourceSession,
    mode: "reuse",
  });

  return {
    kind: "reused",
    session: loadedSession,
  };
};
