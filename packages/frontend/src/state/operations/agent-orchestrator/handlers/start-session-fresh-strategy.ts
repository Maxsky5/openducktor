import { toAgentRuntimePolicyBinding, workflowAgentSessionScope } from "@openducktor/core";
import { readFreshSessionRuntimeKind } from "../support/session-runtime-kind";
import { resolveAgentSessionRuntimePolicy } from "../support/session-runtime-policy";
import type {
  StartAgentSessionInput,
  StartOrReuseResult,
  StartSessionContext,
  StartSessionExecutionDependencies,
} from "./start-session.types";
import { registerStartedSession } from "./start-session-persistence";
import { resolveStartTask } from "./start-session-policies";
import {
  rollbackBootstrapAfterStartFailure,
  stopSessionOnStaleAndThrow,
} from "./start-session-rollback";
import { resolveFreshStartRuntimeContext } from "./start-session-runtime";

type FreshStrategyInput = {
  ctx: StartSessionContext;
  input: Pick<Extract<StartAgentSessionInput, { startMode: "fresh" }>, "selectedModel">;
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
  const selectedModelRuntimeKind = readFreshSessionRuntimeKind(ctx.role, selectedModel);
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
  try {
    const sessionScope = workflowAgentSessionScope(ctx.taskId, ctx.role);
    const loadSettingsSnapshot = deps.model.loadSettingsSnapshot;
    const runtimePolicy = await resolveAgentSessionRuntimePolicy({
      runtimeKind: selectedModelRuntimeKind,
      sessionScope,
      loadSettingsSnapshot,
    });

    const summary = await deps.runtime.adapter.startSession({
      repoPath: ctx.repoPath,
      ...toAgentRuntimePolicyBinding({
        runtimeKind: selectedModelRuntimeKind,
        runtimePolicy,
      }),
      workingDirectory: resolved.runtime.workingDirectory,
      sessionScope,
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

    return await registerStartedSession({
      ctx,
      startedCtx,
      runtimeInfo: resolved.runtime,
      runtimePolicy,
      systemPrompt: resolved.systemPrompt,
      selectedModel: selectedModelWithRuntime,
      deps,
      taskCard,
    });
  } catch (cause) {
    if (!resolved.runtime.bootstrap) {
      throw cause;
    }
    return rollbackBootstrapAfterStartFailure({
      cause,
      bootstrap: resolved.runtime.bootstrap,
    });
  }
};
