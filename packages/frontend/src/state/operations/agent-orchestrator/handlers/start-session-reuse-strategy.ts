import { matchesAgentSessionIdentity, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { throwIfRepoStale } from "../support/core";
import { hasLoadedSessionHistory } from "../transcript/session-transcript-content";
import type {
  StartAgentSessionInput,
  StartOrReuseResult,
  StartSessionContext,
  StartSessionExecutionDependencies,
} from "./start-session.types";
import { STALE_START_ERROR } from "./start-session-constants";
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

  return {
    kind: "reused",
    session: toAgentSessionIdentity(loadedSession),
  };
};
