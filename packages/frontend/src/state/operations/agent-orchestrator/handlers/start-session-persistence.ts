import type { AgentModelSelection } from "@openducktor/core";
import { replaceAgentSession } from "@/state/agent-session-collection";
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

export const registerStartedSession = async ({
  ctx,
  startedCtx,
  runtimeInfo,
  systemPrompt,
  selectedModel,
  initialMessages,
  deps,
  taskCard,
}: {
  ctx: StartSessionContext;
  startedCtx: StartedSessionContext;
  runtimeInfo: ResolvedRuntimeAndModel["runtime"];
  systemPrompt: string;
  selectedModel: AgentModelSelection;
  initialMessages?: import("@/types/agent-orchestrator").AgentSessionState["messages"];
  deps: Pick<StartSessionExecutionDependencies, "session" | "runtime">;
  taskCard: ResolvedRuntimeAndModel["taskCard"];
}): Promise<Extract<StartOrReuseResult, { kind: "started" }>> => {
  const initialSession = buildInitialSession({
    startedCtx,
    selectedModel,
    systemPrompt,
    ...(initialMessages ? { initialMessages } : {}),
  });

  deps.session.setSessionCollection((current) => {
    if (ctx.isStaleRepoOperation()) {
      return current;
    }
    return replaceAgentSession(current, initialSession);
  });
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  try {
    await persistInitialSession({
      initialSession,
      session: deps.session,
      tags: {
        repoPath: startedCtx.repoPath,
        taskId: startedCtx.taskId,
        role: startedCtx.role,
        externalSessionId: startedCtx.summary.externalSessionId,
      },
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
  };
};
