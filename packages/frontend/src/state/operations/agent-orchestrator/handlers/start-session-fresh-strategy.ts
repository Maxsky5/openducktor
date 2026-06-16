import { requireSelectedModelRuntimeKindForStart } from "../support/session-runtime-metadata";
import type {
  StartAgentSessionInput,
  StartOrReuseResult,
  StartSessionContext,
  StartSessionExecutionDependencies,
} from "./start-session.types";
import { registerStartedSession } from "./start-session-persistence";
import { resolveStartTask } from "./start-session-policies";
import { stopSessionOnStaleAndThrow } from "./start-session-rollback";
import { resolveFreshStartRuntimeContext } from "./start-session-runtime";

type FreshStrategyInput = {
  ctx: StartSessionContext;
  input: Pick<
    Extract<StartAgentSessionInput, { startMode: "fresh" }>,
    "startMode" | "selectedModel"
  >;
  targetWorkingDirectory: string | null | undefined;
  deps: StartSessionExecutionDependencies;
};

export const executeFreshStart = async ({
  ctx,
  input,
  targetWorkingDirectory,
  deps,
}: FreshStrategyInput): Promise<Extract<StartOrReuseResult, { kind: "started" }>> => {
  const taskCard = resolveStartTask({ ctx, task: deps.task });
  const selectedModel = input.selectedModel;
  const selectedModelRuntimeKind = requireSelectedModelRuntimeKindForStart(ctx.role, selectedModel);
  const selectedModelWithRuntime = {
    ...selectedModel,
    runtimeKind: selectedModelRuntimeKind,
  };

  const resolved = await resolveFreshStartRuntimeContext({
    ctx,
    requestedRuntimeKind: selectedModelRuntimeKind,
    ...(targetWorkingDirectory !== undefined ? { targetWorkingDirectory } : {}),
    taskCard,
    deps,
  });

  const summary = await deps.runtime.adapter.startSession({
    repoPath: ctx.repoPath,
    runtimeKind: selectedModelRuntimeKind,
    workingDirectory: resolved.runtime.workingDirectory,
    taskId: ctx.taskId,
    role: ctx.role,
    systemPrompt: resolved.systemPrompt,
    model: selectedModelWithRuntime,
  });

  const startedCtx = {
    ...ctx,
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
    selectedModel: selectedModelWithRuntime,
    deps,
    taskCard: resolved.taskCard,
  });
};
