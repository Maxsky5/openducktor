import { matchesAgentSessionIdentity, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { throwIfRepoStale } from "../support/core";
import { hasLoadedSessionHistory } from "../support/session-transcript-content";
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

const unavailableSourceSessionError = (
  ctx: StartSessionContext,
  sourceSession: AgentSessionIdentity,
): Error =>
  new Error(
    `Session "${sourceSession.externalSessionId}" is not available for task "${ctx.taskId}" and role "${ctx.role}".`,
  );

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

const loadSourceSessionWithHistory = async ({
  ctx,
  deps,
  sourceSession,
}: {
  ctx: StartSessionContext;
  deps: StartSessionExecutionDependencies;
  sourceSession: AgentSessionIdentity;
}): Promise<AgentSessionState> => {
  let loadedSession = deps.session.readSessionSnapshot(sourceSession);
  if (!loadedSession) {
    loadedSession = await deps.session.loadSourceSession({
      taskId: ctx.taskId,
      role: ctx.role,
      sourceSession,
    });
    throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);
  }

  if (!loadedSession) {
    throw unavailableSourceSessionError(ctx, sourceSession);
  }

  if (!matchesLoadedSourceSession(loadedSession, ctx, sourceSession)) {
    throw unavailableSourceSessionError(ctx, sourceSession);
  }

  if (hasLoadedSessionHistory(loadedSession)) {
    return loadedSession;
  }

  const historyLoadedSession = await deps.session.loadAgentSessionHistory(sourceSession);
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  if (!historyLoadedSession || !hasLoadedSessionHistory(historyLoadedSession)) {
    throw new Error(
      `Failed to load session "${sourceSession.externalSessionId}" after loading history.`,
    );
  }
  if (!matchesLoadedSourceSession(historyLoadedSession, ctx, sourceSession)) {
    throw unavailableSourceSessionError(ctx, sourceSession);
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

export const resolveLoadedSourceSession = async ({
  ctx,
  deps,
  sourceSession,
}: {
  ctx: StartSessionContext;
  deps: StartSessionExecutionDependencies;
  sourceSession: AgentSessionIdentity;
}): Promise<AgentSessionState> => {
  return loadSourceSessionWithHistory({
    ctx,
    deps,
    sourceSession,
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

  const loadedSession = await loadSourceSessionWithHistory({
    ctx,
    deps,
    sourceSession: input.sourceSession,
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
    session: toAgentSessionIdentity(loadedSession),
  };
};
