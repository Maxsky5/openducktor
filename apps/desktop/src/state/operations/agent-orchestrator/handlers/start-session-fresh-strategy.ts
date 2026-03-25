import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { resolveRuntimeConnection } from "../runtime/runtime";
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
  const targetWorkingDirectory =
    input.targetWorkingDirectory !== undefined
      ? input.targetWorkingDirectory
      : await resolveFreshStartTargetWorkingDirectory({
          ctx,
          resolveBuildContinuationTarget: deps.runtime.resolveBuildContinuationTarget,
        });

  const resolved = await resolveRuntimeAndModel({
    ctx,
    scenario: input.scenario,
    requestedRuntimeKind: selectedModel.runtimeKind,
    ...(targetWorkingDirectory !== undefined ? { targetWorkingDirectory } : {}),
    taskCard,
    deps,
  });

  assertScenarioStartPolicy({
    role: ctx.role,
    scenario: resolved.resolvedScenario,
    startMode: input.startMode,
  });

  const summary = await deps.runtime.adapter.startSession({
    repoPath: ctx.repoPath,
    runtimeKind: resolved.runtime.runtimeKind ?? selectedModel?.runtimeKind ?? DEFAULT_RUNTIME_KIND,
    runtimeConnection: resolveRuntimeConnection(resolved.runtime),
    workingDirectory: resolved.runtime.workingDirectory,
    taskId: ctx.taskId,
    role: ctx.role,
    scenario: resolved.resolvedScenario,
    systemPrompt: resolved.systemPrompt,
    ...(selectedModel ? { model: selectedModel } : {}),
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
    selectedModel,
    deps,
    taskCard: resolved.taskCard,
  });
};
