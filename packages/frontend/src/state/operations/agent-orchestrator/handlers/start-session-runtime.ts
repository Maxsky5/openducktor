import type { RuntimeKind, TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { throwIfRepoStale } from "../support/core";
import { loadSessionPromptContext } from "../support/session-prompt";
import type {
  FreshStartRuntimeContext,
  StartSessionContext,
  StartSessionExecutionDependencies,
} from "./start-session.types";
import { STALE_START_ERROR } from "./start-session-constants";

export const loadStartSystemPrompt = async ({
  ctx,
  taskCard,
  deps,
}: {
  ctx: StartSessionContext;
  taskCard: TaskCard;
  deps: Pick<StartSessionExecutionDependencies, "model">;
}): Promise<string> => {
  const { systemPrompt } = await loadSessionPromptContext({
    workspaceId: ctx.workspaceId,
    role: ctx.role,
    task: taskCard,
    loadRepoPromptOverrides: deps.model.loadRepoPromptOverrides,
  });
  throwIfRepoStale(ctx.isStaleRepoOperation, STALE_START_ERROR);

  return systemPrompt;
};

export const resolveFreshStartRuntimeContext = async ({
  ctx,
  targetWorkingDirectory,
  requestedRuntimeKind,
  taskCard,
  deps,
}: {
  ctx: StartSessionContext;
  targetWorkingDirectory?: string | null;
  requestedRuntimeKind: RuntimeKind;
  taskCard: TaskCard;
  deps: Pick<StartSessionExecutionDependencies, "runtime" | "model">;
}): Promise<FreshStartRuntimeContext> => {
  const systemPrompt = await loadStartSystemPrompt({
    ctx,
    taskCard,
    deps,
  });
  const runtime = await deps.runtime.ensureRuntime(ctx.repoPath, ctx.taskId, ctx.role, {
    workspaceId: ctx.workspaceId,
    ...(targetWorkingDirectory !== undefined ? { targetWorkingDirectory } : {}),
    runtimeKind: requestedRuntimeKind,
  });
  if (ctx.isStaleRepoOperation()) {
    try {
      await runtime.bootstrap?.abort();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${STALE_START_ERROR} Failed to roll back task worktree bootstrap: ${message}`,
        error instanceof Error ? { cause: error } : undefined,
      );
    }
    throw new Error(STALE_START_ERROR);
  }

  return {
    runtime,
    systemPrompt,
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
