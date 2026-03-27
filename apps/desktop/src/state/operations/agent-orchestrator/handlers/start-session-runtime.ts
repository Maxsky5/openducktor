import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentScenario } from "@openducktor/core";
import { normalizeWorkingDirectory, throwIfRepoStale } from "../support/core";
import { inferScenario } from "../support/scenario";
import { createSessionPromptContext, loadSessionPromptInputs } from "../support/session-prompt";
import type {
  ResolvedRuntimeAndModel,
  RuntimeDependencies,
  StartSessionContext,
  StartSessionExecutionDependencies,
} from "./start-session.types";
import { requireBuildContinuationTarget, STALE_START_ERROR } from "./start-session-constants";

export const resolveRuntimeAndModel = async ({
  ctx,
  scenario,
  targetWorkingDirectory,
  requestedRuntimeKind,
  taskCard,
  deps,
}: {
  ctx: StartSessionContext;
  scenario: AgentScenario | undefined;
  targetWorkingDirectory?: string | null;
  requestedRuntimeKind?: AgentModelSelection["runtimeKind"] | null;
  taskCard: TaskCard;
  deps: Pick<StartSessionExecutionDependencies, "runtime" | "task" | "model">;
}): Promise<ResolvedRuntimeAndModel> => {
  const { promptOverrides } = await loadSessionPromptInputs({
    repoPath: ctx.repoPath,
    loadRepoPromptOverrides: deps.model.loadRepoPromptOverrides,
  });
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  const resolvedScenario = scenario ?? inferScenario(ctx.role, taskCard);
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  const runtimeInfo = await deps.runtime.ensureRuntime(ctx.repoPath, ctx.taskId, ctx.role, {
    ...(targetWorkingDirectory !== undefined ? { targetWorkingDirectory } : {}),
    ...(requestedRuntimeKind ? { runtimeKind: requestedRuntimeKind } : {}),
  });
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  const { systemPrompt } = createSessionPromptContext({
    role: ctx.role,
    scenario: resolvedScenario,
    task: taskCard,
    promptOverrides,
  });

  return {
    taskCard,
    runtime: runtimeInfo,
    resolvedScenario,
    systemPrompt,
    promptOverrides,
  };
};

export const resolveFreshStartTargetWorkingDirectory = async ({
  ctx,
  resolveBuildContinuationTarget,
}: {
  ctx: StartSessionContext;
  resolveBuildContinuationTarget: StartSessionExecutionDependencies["runtime"]["resolveBuildContinuationTarget"];
}): Promise<string | null | undefined> => {
  if (ctx.role === "qa") {
    return requireBuildContinuationTarget(
      await resolveBuildContinuationTarget(ctx.repoPath, ctx.taskId),
    ).workingDirectory;
  }

  if (ctx.role !== "build") {
    return undefined;
  }

  return (await resolveBuildContinuationTarget(ctx.repoPath, ctx.taskId))?.workingDirectory ?? null;
};

export const resolveFreshStartTargetWorkingDirectoryForStart = async ({
  ctx,
  runtime,
  targetWorkingDirectory,
}: {
  ctx: StartSessionContext;
  runtime: RuntimeDependencies;
  targetWorkingDirectory?: string | null;
}): Promise<{
  targetWorkingDirectory: string | null | undefined;
  normalizedTargetWorkingDirectory: string;
}> => {
  if (targetWorkingDirectory !== undefined) {
    return {
      targetWorkingDirectory,
      normalizedTargetWorkingDirectory: normalizeWorkingDirectory(targetWorkingDirectory),
    };
  }

  const targetWorkingDirectoryForStart = await resolveFreshStartTargetWorkingDirectory({
    ctx,
    resolveBuildContinuationTarget: runtime.resolveBuildContinuationTarget,
  });
  return {
    targetWorkingDirectory: targetWorkingDirectoryForStart,
    normalizedTargetWorkingDirectory: normalizeWorkingDirectory(targetWorkingDirectoryForStart),
  };
};

export const serializeSelectedModelKey = (
  selectedModel: AgentModelSelection | undefined,
): string => {
  if (!selectedModel) {
    return "";
  }
  return [
    selectedModel.runtimeKind ?? "",
    selectedModel.providerId,
    selectedModel.modelId,
    selectedModel.variant ?? "",
    selectedModel.profileId ?? "",
  ].join("::");
};
