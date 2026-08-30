import type { AgentModelSelection } from "@openducktor/core";
import { throwIfRepoStale } from "../support/core";
import { loadSessionPromptContext, type SessionPromptTask } from "../support/session-prompt";
import type { StartSessionContext, StartSessionExecutionDependencies } from "./start-session.types";
import { STALE_START_ERROR } from "./start-session-constants";

export const loadStartSystemPrompt = async ({
  ctx,
  taskCard,
  deps,
}: {
  ctx: StartSessionContext;
  taskCard: SessionPromptTask;
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
