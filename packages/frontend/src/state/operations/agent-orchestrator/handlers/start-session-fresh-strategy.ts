import {
  assertSelectedModelRuntimeKindMatchesEnsuredRuntime,
  requireSelectedModelRuntimeKindForStart,
} from "../support/session-runtime-metadata";
import type {
  StartOrReuseResult,
  StartSessionContext,
  StartSessionCreationInput,
  StartSessionExecutionDependencies,
} from "./start-session.types";
import { registerStartedSession } from "./start-session-persistence";
import { assertScenarioStartPolicy, resolveStartTask } from "./start-session-policies";
import { stopSessionOnStaleAndThrow } from "./start-session-rollback";
import {
  resolveFreshStartTargetWorkingDirectory,
  resolveRuntimeAndModel,
} from "./start-session-runtime";

type FreshStrategyInput = {
  ctx: StartSessionContext;
  input: Extract<StartSessionCreationInput, { startMode: "fresh" }>;
  deps: StartSessionExecutionDependencies;
};

export const executeFreshStart = async ({
  ctx,
  input,
  deps,
}: FreshStrategyInput): Promise<Extract<StartOrReuseResult, { kind: "started" }>> => {
  const taskCard = resolveStartTask({ ctx, task: deps.task });
  const selectedModel = input.selectedModel;
  const selectedModelRuntimeKind = requireSelectedModelRuntimeKindForStart(ctx.role, selectedModel);
  const selectedModelWithRuntime = {
    ...selectedModel,
    runtimeKind: selectedModelRuntimeKind,
  };
  const targetWorkingDirectory =
    input.targetWorkingDirectory !== undefined
      ? input.targetWorkingDirectory
      : await resolveFreshStartTargetWorkingDirectory({
          ctx,
          resolveTaskWorktree: deps.runtime.resolveTaskWorktree,
        });

  const resolved = await resolveRuntimeAndModel({
    ctx,
    scenario: input.scenario,
    requestedRuntimeKind: selectedModelRuntimeKind,
    ...(targetWorkingDirectory !== undefined ? { targetWorkingDirectory } : {}),
    taskCard,
    deps,
  });

  assertScenarioStartPolicy({
    role: ctx.role,
    scenario: resolved.resolvedScenario,
    startMode: input.startMode,
  });
  const runtimeKind = assertSelectedModelRuntimeKindMatchesEnsuredRuntime({
    selectedModelRuntimeKind,
    ensuredRuntimeKind: resolved.runtime.runtimeKind,
  });

  const summary = await deps.runtime.adapter.startSession({
    repoPath: ctx.repoPath,
    runtimeKind,
    workingDirectory: resolved.runtime.workingDirectory,
    taskId: ctx.taskId,
    role: ctx.role,
    scenario: resolved.resolvedScenario,
    systemPrompt: resolved.systemPrompt,
    model: selectedModelWithRuntime,
  });

  const startedCtx = {
    ...ctx,
    resolvedScenario: resolved.resolvedScenario,
    summary,
  };

  if (ctx.isStaleRepoOperation()) {
    await stopSessionOnStaleAndThrow({
      reason: "start-session-stop-on-stale-after-start",
      runtime: deps.runtime,
      startedCtx,
    });
  }

  return registerStartedSession({
    ctx,
    startedCtx,
    runtimeInfo: resolved.runtime,
    systemPrompt: resolved.systemPrompt,
    promptOverrides: resolved.promptOverrides,
    selectedModel: selectedModelWithRuntime,
    deps,
    taskCard: resolved.taskCard,
  });
};
