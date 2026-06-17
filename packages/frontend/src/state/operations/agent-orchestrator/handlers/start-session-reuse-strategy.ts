import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { throwIfRepoStale } from "../support/core";
import type {
  StartAgentSessionInput,
  StartOrReuseResult,
  StartSessionContext,
  StartSessionExecutionDependencies,
} from "./start-session.types";
import { requireBuildContinuationTarget, STALE_START_ERROR } from "./start-session-constants";
import { resolveStartTask } from "./start-session-policies";

type ReuseStrategyInput = {
  ctx: StartSessionContext;
  input: Pick<Extract<StartAgentSessionInput, { startMode: "reuse" }>, "sourceSession">;
  deps: StartSessionExecutionDependencies;
};

const hasLoadedSessionHistory = (session: Pick<AgentSessionState, "historyLoadState">): boolean =>
  session.historyLoadState === "loaded";

const unavailableSourceSessionError = (
  ctx: StartSessionContext,
  sourceSession: AgentSessionIdentity,
): Error =>
  new Error(
    `Session "${sourceSession.externalSessionId}" is not available for task "${ctx.taskId}" and role "${ctx.role}".`,
  );

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
  const currentSession = deps.session.readSessionSnapshot(sourceSession);
  if (forceReload || !currentSession) {
    await deps.session.loadAgentSessions(ctx.taskId);
    throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);
  }

  const loadedSession = deps.session.readSessionSnapshot(sourceSession);
  if (!loadedSession) {
    throw unavailableSourceSessionError(ctx, sourceSession);
  }

  if (!hasLoadedSessionHistory(loadedSession)) {
    await deps.session.loadAgentSessionHistory(sourceSession);
    throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);
  }

  const historyLoadedSession = deps.session.readSessionSnapshot(sourceSession);
  if (!historyLoadedSession) {
    throw new Error(
      `Failed to load session "${sourceSession.externalSessionId}" for ${mode === "reuse" ? "reuse" : "forking"}.`,
    );
  }

  return historyLoadedSession;
};

const validateReusableSession = async ({
  ctx,
  deps,
  session,
}: {
  ctx: StartSessionContext;
  deps: Pick<StartSessionExecutionDependencies, "runtime">;
  session: Pick<AgentSessionState, "workingDirectory">;
}): Promise<string | null> => {
  if (ctx.role !== "qa" && ctx.role !== "build") {
    return null;
  }

  let expectedWorkingDirectory: string;
  try {
    expectedWorkingDirectory = normalizeWorkingDirectory(
      requireBuildContinuationTarget(
        await deps.runtime.resolveTaskWorktree(ctx.repoPath, ctx.taskId),
      ).workingDirectory,
    );
  } catch (error) {
    if (ctx.role === "build") {
      return "it does not match the current builder continuation target";
    }
    throw error;
  }

  if (normalizeWorkingDirectory(session.workingDirectory) === expectedWorkingDirectory) {
    return null;
  }

  return ctx.role === "qa"
    ? "it does not match the required builder worktree for this QA session"
    : "it does not match the current builder continuation target";
};

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
  matchesAgentSessionIdentity(session, sourceSession);

const ensureLoadedSourceSession = async ({
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
  const loadedSession = await loadSessionForReuse({
    ctx,
    deps,
    sourceSession,
    mode,
    forceReload,
  });
  if (!matchesLoadedSourceSession(loadedSession, ctx, sourceSession)) {
    throw unavailableSourceSessionError(ctx, sourceSession);
  }
  return loadedSession;
};

export const resolveLoadedSourceSession = async ({
  ctx,
  deps,
  sourceSession,
}: {
  ctx: StartSessionContext;
  deps: StartSessionExecutionDependencies;
  sourceSession: AgentSessionIdentity;
}): Promise<AgentSessionState> => {
  const existingSourceSession = deps.session.readSessionSnapshot(sourceSession);
  if (existingSourceSession) {
    if (!matchesLoadedSourceSession(existingSourceSession, ctx, sourceSession)) {
      throw unavailableSourceSessionError(ctx, sourceSession);
    }
    if (hasLoadedSessionHistory(existingSourceSession)) {
      return existingSourceSession;
    }
  }

  return ensureLoadedSourceSession({
    ctx,
    deps,
    sourceSession,
    mode: "fork",
    forceReload: existingSourceSession !== null,
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

  const existingSession = deps.session.readSessionSnapshot(input.sourceSession);
  if (existingSession) {
    if (!matchesLoadedSourceSession(existingSession, ctx, input.sourceSession)) {
      throw unavailableSourceSessionError(ctx, input.sourceSession);
    }
    const reuseError = await validateReusableSession({
      ctx,
      deps,
      session: existingSession,
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

  const loadedSession = await ensureLoadedSourceSession({
    ctx,
    deps,
    sourceSession: input.sourceSession,
    mode: "reuse",
  });

  const reuseError = await validateReusableSession({
    ctx,
    deps,
    session: loadedSession,
  });
  if (reuseError) {
    throw new Error(
      `Session "${input.sourceSession.externalSessionId}" cannot be reused because ${reuseError}.`,
    );
  }

  return {
    kind: "reused",
    session: loadedSession,
  };
};
