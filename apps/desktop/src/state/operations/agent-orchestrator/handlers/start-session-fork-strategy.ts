import type { AgentRuntimeConnection } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { RuntimeInfo } from "../runtime/runtime";
import { requireRuntimeConnectionSupport, resolveRuntimeConnection } from "../runtime/runtime";
import { throwIfRepoStale } from "../support/core";
import { createSessionMessagesState, getSessionMessagesSlice } from "../support/messages";
import { historyToChatMessages } from "../support/persistence";
import { buildSessionHeaderMessages } from "../support/session-prompt";
import type {
  StartOrReuseResult,
  StartSessionContext,
  StartSessionCreationInput,
  StartSessionExecutionDependencies,
} from "./start-session.types";
import { STALE_START_ERROR } from "./start-session-constants";
import { registerStartedSession } from "./start-session-persistence";
import { assertScenarioStartPolicy, resolveStartTask } from "./start-session-policies";
import { resolveLoadedSourceSession } from "./start-session-reuse-strategy";
import {
  rollbackStartedSessionBeforeRegistration,
  stopSessionOnStaleAndThrow,
} from "./start-session-rollback";
import { resolveScenarioAndPrompt } from "./start-session-runtime";

// Match the requested-history hydration cap so newly forked child sessions load
// enough history to render immediately without pulling an unbounded transcript.
const FORK_START_HISTORY_LIMIT = 600;

type ForkStrategyInput = {
  ctx: StartSessionContext;
  input: Extract<StartSessionCreationInput, { startMode: "fork" }>;
  deps: StartSessionExecutionDependencies;
};

const requireForkSourceRuntime = (
  sourceSessionId: string,
  sourceSession: AgentSessionState,
): {
  runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>;
  runtimeConnection: AgentRuntimeConnection;
} => {
  const sourceRuntimeKind = sourceSession.runtimeKind;
  if (!sourceRuntimeKind) {
    throw new Error(
      `Session "${sourceSessionId}" is missing runtime kind metadata required for forking.`,
    );
  }

  const sourceRuntime: RuntimeInfo = {
    runtimeKind: sourceRuntimeKind,
    runtimeId: sourceSession.runtimeId,
    runId: sourceSession.runId,
    runtimeRoute: sourceSession.runtimeRoute,
    workingDirectory: sourceSession.workingDirectory,
  };

  try {
    return {
      runtimeKind: sourceRuntimeKind,
      runtimeConnection: resolveRuntimeConnection(sourceRuntime),
    };
  } catch {
    throw new Error(
      `Session "${sourceSessionId}" is missing live runtime context required for forking.`,
    );
  }
};

export const executeForkStart = async ({
  ctx,
  input,
  deps,
}: ForkStrategyInput): Promise<Extract<StartOrReuseResult, { kind: "started" }>> => {
  const sourceSession = await resolveLoadedSourceSession({
    ctx,
    deps,
    sourceSessionId: input.sourceSessionId,
  });
  const { runtimeKind: sourceRuntimeKind, runtimeConnection: sourceRuntimeConnection } =
    requireForkSourceRuntime(input.sourceSessionId, sourceSession);
  const taskCard = resolveStartTask({ ctx, task: deps.task });
  const selectedModel = input.selectedModel;

  if (selectedModel.runtimeKind && sourceRuntimeKind !== selectedModel.runtimeKind) {
    throw new Error(
      `Session "${input.sourceSessionId}" cannot be forked with runtime "${selectedModel.runtimeKind}" because it belongs to runtime "${sourceRuntimeKind}".`,
    );
  }

  const promptContext = await resolveScenarioAndPrompt({
    ctx,
    scenario: input.scenario,
    taskCard,
    deps,
  });

  assertScenarioStartPolicy({
    role: ctx.role,
    scenario: promptContext.resolvedScenario,
    startMode: input.startMode,
  });

  const runtimeKind = sourceRuntimeKind;
  const supportedRuntimeConnection = requireRuntimeConnectionSupport(
    runtimeKind,
    sourceRuntimeConnection,
    "fork session",
  );

  const summary = await deps.runtime.adapter.forkSession({
    repoPath: ctx.repoPath,
    runtimeKind,
    runtimeConnection: supportedRuntimeConnection,
    workingDirectory: sourceSession.workingDirectory,
    taskId: ctx.taskId,
    role: ctx.role,
    scenario: promptContext.resolvedScenario,
    systemPrompt: promptContext.systemPrompt,
    ...(sourceSession.runtimeId ? { runtimeId: sourceSession.runtimeId } : {}),
    ...(selectedModel ? { model: selectedModel } : {}),
    parentExternalSessionId: sourceSession.externalSessionId,
  });

  const startedCtx = {
    ...ctx,
    resolvedScenario: promptContext.resolvedScenario,
    summary,
  };

  if (ctx.isStaleRepoOperation()) {
    await stopSessionOnStaleAndThrow({
      reason: "start-session-stop-on-stale-after-fork",
      runtime: deps.runtime,
      startedCtx,
    });
  }

  const forkHistory = await deps.runtime.adapter
    .loadSessionHistory({
      runtimeKind,
      runtimeConnection: supportedRuntimeConnection,
      externalSessionId: summary.externalSessionId,
      limit: FORK_START_HISTORY_LIMIT,
    })
    .catch((error) =>
      rollbackStartedSessionBeforeRegistration({
        error,
        startedCtx,
        runtime: deps.runtime,
        reason: "start-session-stop-after-fork-history-load-failure",
      }),
    );

  if (ctx.isStaleRepoOperation()) {
    await stopSessionOnStaleAndThrow({
      reason: "start-session-stop-on-stale-after-fork-history-load",
      runtime: deps.runtime,
      startedCtx,
    });
  }
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  const initialMessages: AgentSessionState["messages"] = createSessionMessagesState(
    summary.sessionId,
    [
      ...getSessionMessagesSlice(
        {
          sessionId: summary.sessionId,
          messages: buildSessionHeaderMessages({
            sessionId: summary.sessionId,
            role: ctx.role,
            scenario: promptContext.resolvedScenario,
            systemPrompt: promptContext.systemPrompt,
            startedAt: summary.startedAt,
            eventLabel: "forked",
          }),
        },
        0,
      ),
      ...historyToChatMessages(forkHistory, {
        role: ctx.role,
        selectedModel,
      }),
    ],
  );

  const forkedRuntime: RuntimeInfo = {
    runtimeKind,
    runtimeId: sourceSession.runtimeId,
    runId: sourceSession.runId,
    runtimeRoute: sourceSession.runtimeRoute,
    runtimeConnection: supportedRuntimeConnection,
    workingDirectory: sourceSession.workingDirectory,
  };

  return registerStartedSession({
    ctx,
    startedCtx,
    runtimeInfo: forkedRuntime,
    systemPrompt: promptContext.systemPrompt,
    promptOverrides: promptContext.promptOverrides,
    selectedModel,
    initialMessages,
    deps,
    taskCard,
  });
};
