import type { AgentModelSelection } from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { runOrchestratorTask } from "../support/async-side-effects";
import { throwIfRepoStale } from "../support/core";
import { toPersistedSessionRecord } from "../support/persistence";
import { buildSessionPreludeMessages } from "../support/session-prompt";
import type {
  ResolvedRuntimeAndModel,
  RuntimeDependencies,
  SessionDependencies,
  SessionStartTags,
  StartedSessionContext,
  StartOrReuseResult,
  StartSessionContext,
  StartSessionExecutionDependencies,
} from "./start-session.types";
import { STALE_START_ERROR } from "./start-session-constants";
import { createSessionStartTags } from "./start-session-support";

export const buildInitialSession = ({
  startedCtx,
  selectedModel,
  runtime,
  systemPrompt,
  promptOverrides,
}: {
  startedCtx: StartedSessionContext;
  selectedModel: AgentModelSelection;
  runtime: ResolvedRuntimeAndModel["runtime"];
  systemPrompt: string;
  promptOverrides: ResolvedRuntimeAndModel["promptOverrides"];
}): AgentSessionState => ({
  sessionId: startedCtx.summary.sessionId,
  externalSessionId: startedCtx.summary.externalSessionId,
  taskId: startedCtx.taskId,
  runtimeKind: runtime.runtimeKind ?? selectedModel?.runtimeKind ?? DEFAULT_RUNTIME_KIND,
  role: startedCtx.role,
  scenario: startedCtx.resolvedScenario,
  status: "starting",
  startedAt: startedCtx.summary.startedAt,
  runtimeId: runtime.runtimeId,
  runId: runtime.runId,
  runtimeEndpoint: runtime.runtimeEndpoint,
  workingDirectory: runtime.workingDirectory,
  messages: buildSessionPreludeMessages({
    sessionId: startedCtx.summary.sessionId,
    role: startedCtx.role,
    scenario: startedCtx.resolvedScenario,
    systemPrompt,
    startedAt: startedCtx.summary.startedAt,
  }),
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  contextUsage: null,
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel,
  isLoadingModelCatalog: true,
  promptOverrides,
});

export const persistInitialSession = async ({
  initialSession,
  session,
  tags,
}: {
  initialSession: AgentSessionState;
  session: SessionDependencies;
  tags: SessionStartTags;
}): Promise<void> => {
  await runOrchestratorTask(
    "start-session-persist-initial-session",
    async () => {
      await session.persistSessionRecord(
        initialSession.taskId,
        toPersistedSessionRecord(initialSession),
      );
    },
    { tags },
  );
};

export const stopSessionOnStaleAndThrow = async ({
  reason,
  runtime,
  startedCtx,
}: {
  reason: string;
  runtime: RuntimeDependencies;
  startedCtx: StartedSessionContext;
}): Promise<never> => {
  const tags = createSessionStartTags(startedCtx);
  try {
    await runOrchestratorTask(reason, async () => runtime.adapter.stopSession(tags.sessionId), {
      tags,
    });
  } catch (error) {
    throw new Error(
      `${STALE_START_ERROR} Failed to stop stale started session '${tags.sessionId}': ${errorMessage(error)}`,
      { cause: error },
    );
  }
  throw new Error(STALE_START_ERROR);
};

export const rollbackStartedSessionAfterPersistenceFailure = async ({
  error,
  startedCtx,
  session,
  runtime,
}: {
  error: unknown;
  startedCtx: StartedSessionContext;
  session: SessionDependencies;
  runtime: RuntimeDependencies;
}): Promise<never> => {
  const sessionId = startedCtx.summary.sessionId;
  session.setSessionsById((current) => {
    if (!(sessionId in current)) {
      return current;
    }
    const next = { ...current };
    delete next[sessionId];
    return next;
  });

  try {
    await runOrchestratorTask(
      "start-session-stop-after-persist-failure",
      async () => runtime.adapter.stopSession(sessionId),
      { tags: createSessionStartTags(startedCtx) },
    );
  } catch (stopError) {
    throw new Error(
      `Failed to persist started session "${sessionId}": ${errorMessage(error)}. Failed to stop the started session during rollback: ${errorMessage(stopError)}`,
      { cause: stopError },
    );
  }

  throw new Error(
    `Failed to persist started session "${sessionId}": ${errorMessage(error)}. The started session was stopped and removed locally.`,
    error instanceof Error ? { cause: error } : undefined,
  );
};

export const registerStartedSession = async ({
  ctx,
  startedCtx,
  runtimeInfo,
  systemPrompt,
  promptOverrides,
  selectedModel,
  deps,
  taskCard,
}: {
  ctx: StartSessionContext;
  startedCtx: StartedSessionContext;
  runtimeInfo: ResolvedRuntimeAndModel["runtime"];
  systemPrompt: string;
  promptOverrides: ResolvedRuntimeAndModel["promptOverrides"];
  selectedModel: AgentModelSelection;
  deps: Pick<StartSessionExecutionDependencies, "session" | "runtime">;
  taskCard: ResolvedRuntimeAndModel["taskCard"];
}): Promise<Extract<StartOrReuseResult, { kind: "started" }>> => {
  const initialSession = buildInitialSession({
    startedCtx,
    selectedModel,
    runtime: runtimeInfo,
    systemPrompt,
    promptOverrides,
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
