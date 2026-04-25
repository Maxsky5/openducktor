import type { AgentModelSelection } from "@openducktor/core";
import { throwIfRepoStale } from "../support/core";
import type {
  ResolvedRuntimeAndModel,
  StartedSessionContext,
  StartOrReuseResult,
  StartSessionContext,
  StartSessionExecutionDependencies,
} from "./start-session.types";
import { STALE_START_ERROR } from "./start-session-constants";
import { buildInitialSession, persistInitialSession } from "./start-session-local-state";
import { rollbackStartedSessionAfterPersistenceFailure } from "./start-session-rollback";
import { createSessionStartTags } from "./start-session-support";

export const registerStartedSession = async ({
  ctx,
  startedCtx,
  runtimeInfo,
  systemPrompt,
  promptOverrides,
  selectedModel,
  initialMessages,
  deps,
  taskCard,
}: {
  ctx: StartSessionContext;
  startedCtx: StartedSessionContext;
  runtimeInfo: ResolvedRuntimeAndModel["runtime"];
  systemPrompt: string;
  promptOverrides: ResolvedRuntimeAndModel["promptOverrides"];
  selectedModel: AgentModelSelection;
  initialMessages?: import("@/types/agent-orchestrator").AgentSessionState["messages"];
  deps: Pick<StartSessionExecutionDependencies, "session" | "runtime">;
  taskCard: ResolvedRuntimeAndModel["taskCard"];
}): Promise<Extract<StartOrReuseResult, { kind: "started" }>> => {
  const initialSession = buildInitialSession({
    startedCtx,
    selectedModel,
    runtime: runtimeInfo,
    systemPrompt,
    promptOverrides,
    ...(initialMessages ? { initialMessages } : {}),
  });

  deps.session.setSessionsById((current) => {
    if (ctx.isStaleRepoOperation()) {
      return current;
    }
    return {
      ...current,
      [startedCtx.summary.sessionId]: initialSession,
    };
  });
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  try {
    await persistInitialSession({
      initialSession,
      session: deps.session,
      tags: createSessionStartTags(startedCtx),
    });
  } catch (error) {
    await rollbackStartedSessionAfterPersistenceFailure({
      error,
      startedCtx,
      session: deps.session,
      runtime: deps.runtime,
    });
  }

  return {
    kind: "started",
    runtimeInfo,
    taskCard,
    ctx: startedCtx,
    promptOverrides,
  };
};
