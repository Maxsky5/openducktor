import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { normalizeWorkingDirectory, throwIfRepoStale } from "../support/core";
import { createSessionPromptContext, loadSessionPromptInputs } from "../support/session-prompt";
import type {
  ResolvedRuntimeAndModel,
  RuntimeDependencies,
  StartSessionContext,
  StartSessionExecutionDependencies,
} from "./start-session.types";
import { requireBuildContinuationTarget, STALE_START_ERROR } from "./start-session-constants";

export const resolvePromptContext = async ({
  ctx,
  taskCard,
  deps,
}: {
  ctx: StartSessionContext;
  taskCard: TaskCard;
  deps: Pick<StartSessionExecutionDependencies, "model">;
}): Promise<Pick<ResolvedRuntimeAndModel, "systemPrompt" | "promptOverrides">> => {
  const { promptOverrides } = await loadSessionPromptInputs({
    workspaceId: ctx.workspaceId,
    loadRepoPromptOverrides: deps.model.loadRepoPromptOverrides,
  });
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  const { systemPrompt } = createSessionPromptContext({
    role: ctx.role,
    task: taskCard,
    promptOverrides,
  });

  return {
    systemPrompt,
    promptOverrides,
  };
};

export const resolveRuntimeAndModel = async ({
  ctx,
  targetWorkingDirectory,
  requestedRuntimeKind,
  taskCard,
  deps,
}: {
  ctx: StartSessionContext;
  targetWorkingDirectory?: string | null;
  requestedRuntimeKind?: AgentModelSelection["runtimeKind"] | null;
  taskCard: TaskCard;
  deps: Pick<StartSessionExecutionDependencies, "runtime" | "task" | "model">;
}): Promise<ResolvedRuntimeAndModel> => {
  const promptContext = await resolvePromptContext({
    ctx,
    taskCard,
    deps,
  });
  const runtimeInfo = await deps.runtime.ensureRuntime(ctx.repoPath, ctx.taskId, ctx.role, {
    workspaceId: ctx.workspaceId,
    ...(targetWorkingDirectory !== undefined ? { targetWorkingDirectory } : {}),
    ...(requestedRuntimeKind ? { runtimeKind: requestedRuntimeKind } : {}),
  });
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  return {
    taskCard,
    runtime: runtimeInfo,
    ...promptContext,
  };
};

export const resolveFreshStartTargetWorkingDirectory = async ({
  ctx,
  resolveTaskWorktree,
}: {
  ctx: StartSessionContext;
  resolveTaskWorktree: StartSessionExecutionDependencies["runtime"]["resolveTaskWorktree"];
}): Promise<string | null | undefined> => {
  if (ctx.role === "qa") {
    return requireBuildContinuationTarget(await resolveTaskWorktree(ctx.repoPath, ctx.taskId))
      .workingDirectory;
  }

  if (ctx.role !== "build") {
    return undefined;
  }

  return (await resolveTaskWorktree(ctx.repoPath, ctx.taskId))?.workingDirectory ?? null;
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
    resolveTaskWorktree: runtime.resolveTaskWorktree,
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
