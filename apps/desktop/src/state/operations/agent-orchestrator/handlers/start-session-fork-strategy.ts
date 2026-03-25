import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import type { RuntimeInfo } from "../runtime/runtime";
import type {
  StartOrReuseResult,
  StartSessionContext,
  StartSessionCreationInput,
  StartSessionExecutionDependencies,
} from "./start-session.types";
import { resolveLoadedSourceSession } from "./start-session-reuse-strategy";
import {
  assertScenarioStartPolicy,
  registerStartedSession,
  resolveRuntimeAndModel,
  resolveStartTask,
  stopSessionOnStaleAndThrow,
} from "./start-session-shared";

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

  const summary = await deps.runtime.adapter.forkSession({
    repoPath: ctx.repoPath,
    runtimeKind:
      sourceSession.runtimeKind ??
      resolved.runtime.runtimeKind ??
      selectedModel?.runtimeKind ??
      DEFAULT_RUNTIME_KIND,
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

  const forkedRuntime: RuntimeInfo = {
    runtimeKind:
      sourceSession.runtimeKind ??
      resolved.runtime.runtimeKind ??
      selectedModel?.runtimeKind ??
      DEFAULT_RUNTIME_KIND,
    runtimeId: sourceSession.runtimeId ?? resolved.runtime.runtimeId,
    runId: sourceSession.runId ?? resolved.runtime.runId,
    runtimeEndpoint: sourceSession.runtimeEndpoint || resolved.runtime.runtimeEndpoint,
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
    deps,
    taskCard: resolved.taskCard,
  });
};
