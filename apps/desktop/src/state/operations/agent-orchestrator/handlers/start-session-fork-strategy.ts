import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { RuntimeInfo } from "../runtime/runtime";
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
import { resolveRuntimeAndModel } from "./start-session-runtime";

// Match the requested-history hydration cap so newly forked child sessions load
// enough history to render immediately without pulling an unbounded transcript.
const FORK_START_HISTORY_LIMIT = 600;

type ForkStrategyInput = {
  ctx: StartSessionContext;
  input: Extract<StartSessionCreationInput, { startMode: "fork" }>;
  deps: StartSessionExecutionDependencies;
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
  const taskCard = resolveStartTask({ ctx, task: deps.task });
  const resolved = await resolveRuntimeAndModel({
    ctx,
    scenario: input.scenario,
    requestedRuntimeKind: input.selectedModel.runtimeKind,
    targetWorkingDirectory: sourceSession.workingDirectory,
    taskCard,
    deps,
  });
  const selectedModel = input.selectedModel;

  if (
    sourceSession.runtimeKind &&
    selectedModel.runtimeKind &&
    sourceSession.runtimeKind !== selectedModel.runtimeKind
  ) {
    throw new Error(
      `Session "${input.sourceSessionId}" cannot be forked with runtime "${selectedModel.runtimeKind}" because it belongs to runtime "${sourceSession.runtimeKind}".`,
    );
  }

  assertScenarioStartPolicy({
    role: ctx.role,
    scenario: resolved.resolvedScenario,
    startMode: input.startMode,
  });

  const runtimeKind =
    sourceSession.runtimeKind ??
    resolved.runtime.runtimeKind ??
    selectedModel?.runtimeKind ??
    DEFAULT_RUNTIME_KIND;

  const summary = await deps.runtime.adapter.forkSession({
    repoPath: ctx.repoPath,
    runtimeKind,
    runtimeConnection: {
      endpoint: sourceSession.runtimeEndpoint || resolved.runtime.runtimeEndpoint,
      workingDirectory: sourceSession.workingDirectory,
    },
    workingDirectory: sourceSession.workingDirectory,
    taskId: ctx.taskId,
    role: ctx.role,
    scenario: resolved.resolvedScenario,
    systemPrompt: resolved.systemPrompt,
    ...(sourceSession.runtimeId ? { runtimeId: sourceSession.runtimeId } : {}),
    ...(selectedModel ? { model: selectedModel } : {}),
    parentExternalSessionId: sourceSession.externalSessionId,
  });

  const startedCtx = {
    ...ctx,
    resolvedScenario: resolved.resolvedScenario,
    summary,
  };

  if (ctx.isStaleRepoOperation()) {
    await stopSessionOnStaleAndThrow({
      reason: "start-session-stop-on-stale-after-fork",
      runtime: deps.runtime,
      startedCtx,
    });
  }

  const runtimeConnection = {
    endpoint: sourceSession.runtimeEndpoint || resolved.runtime.runtimeEndpoint,
    workingDirectory: sourceSession.workingDirectory,
  };

  const forkHistory = await deps.runtime.adapter
    .loadSessionHistory({
      runtimeKind,
      runtimeConnection,
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
            scenario: resolved.resolvedScenario,
            systemPrompt: resolved.systemPrompt,
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
    runtimeId: sourceSession.runtimeId ?? resolved.runtime.runtimeId,
    runId: sourceSession.runId ?? resolved.runtime.runId,
    runtimeEndpoint: runtimeConnection.endpoint,
    workingDirectory: sourceSession.workingDirectory,
    ...(resolved.runtime.kind ? { kind: resolved.runtime.kind } : {}),
  };

  return registerStartedSession({
    ctx,
    startedCtx,
    runtimeInfo: forkedRuntime,
    systemPrompt: resolved.systemPrompt,
    promptOverrides: resolved.promptOverrides,
    selectedModel,
    initialMessages,
    deps,
    taskCard: resolved.taskCard,
  });
};
