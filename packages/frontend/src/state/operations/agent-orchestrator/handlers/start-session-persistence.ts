import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import type { RuntimeInfo } from "../runtime/runtime";
import { throwIfRepoStale } from "../support/core";
import type {
  StartedSessionContext,
  StartOrReuseResult,
  StartSessionContext,
  StartSessionExecutionDependencies,
} from "./start-session.types";
import { STALE_START_ERROR } from "./start-session-constants";
import { buildInitialSession, persistInitialSession } from "./start-session-local-state";
import {
  rollbackStartedSessionAfterPersistenceFailure,
  stopSessionOnStaleAndThrow,
} from "./start-session-rollback";

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
  runtimeInfo: RuntimeInfo;
  systemPrompt: string;
  selectedModel: AgentModelSelection;
  initialMessages?: import("@/types/agent-orchestrator").AgentSessionState["messages"];
  deps: Pick<StartSessionExecutionDependencies, "session" | "runtime">;
  taskCard: TaskCard;
}): Promise<Extract<StartOrReuseResult, { kind: "started" }>> => {
  const initialSessionInput: Parameters<typeof buildInitialSession>[0] = {
    startedCtx,
    selectedModel,
    systemPrompt,
  };
  if (initialMessages) {
    initialSessionInput.initialMessages = initialMessages;
  }
  const initialSession = buildInitialSession(initialSessionInput);

  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);
  deps.session.replaceSession(initialSession);
  if (ctx.isStaleRepoOperation()) {
    deps.session.removeSession(initialSession);
    await stopSessionOnStaleAndThrow({
      reason: "start-session-stop-on-stale-after-local-registration",
      runtime: deps.runtime,
      startedCtx,
    });
  }

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
    const rollbackInput: Parameters<typeof rollbackStartedSessionAfterPersistenceFailure>[0] = {
      error,
      startedCtx,
      session: deps.session,
      runtime: deps.runtime,
    };
    if (runtimeInfo.bootstrap) {
      rollbackInput.bootstrap = runtimeInfo.bootstrap;
    }
    await rollbackStartedSessionAfterPersistenceFailure(rollbackInput);
  }

  return {
    kind: "started",
    runtimeInfo,
    taskCard,
    ctx: startedCtx,
  };
};
