import type { AgentTextGenerationInput, TaskCard, WorkspaceRef } from "@openducktor/contracts";
import { goalTaskMaterial, type TaskWorkflow } from "@openducktor/workflows";
import type { QueryClient } from "@tanstack/react-query";
import { connectionHost } from "../../connection/client-connection";
import { loadTaskDocumentFromQuery } from "../../queries/documents";
import { loadPromptSettings } from "../../queries/prompt-settings";
import type { RuntimeBoundModelSelection } from "../../lib/repo-agent-defaults";

export const GOAL_GENERATION_NEEDS_DEFAULT_MODEL =
  "Set a default model in the repository settings to generate a goal.";

/**
 * Asks the model to write the goal of a launch. The goal prompt of the workflow, with the
 * global and repository prompt layers, gives the instructions. The model gets no tools, so the client
 * sends the task, its workflow artifacts, and the default goal of the launch.
 */
export const generateSessionStartGoal = async ({
  queryClient,
  workspace,
  task,
  taskWorkflow,
  launchActionId,
  humanFeedback,
  defaultObjective,
  model,
}: {
  queryClient: QueryClient;
  workspace: WorkspaceRef;
  task: Pick<TaskCard, "id" | "title" | "description" | "issueType" | "status" | "artifactSummary">;
  taskWorkflow: TaskWorkflow;
  launchActionId: string;
  humanFeedback: string | undefined;
  defaultObjective: string;
  model: RuntimeBoundModelSelection;
}): Promise<string> => {
  const [settings, documents] = await Promise.all([
    loadPromptSettings(workspace.workspaceId, queryClient),
    // Only the artifacts that the task has are material.
    Promise.all(
      taskWorkflow.definition.artifacts
        .filter(({ id }) => task.artifactSummary[id]?.present)
        .map(async ({ id, label }) => ({
          label,
          markdown: (await loadTaskDocumentFromQuery(queryClient, workspace, task.id, id)).markdown,
        })),
    ),
  ]);
  const instructions = taskWorkflow.prompts.goalPrompt({
    launchActionId,
    task: {
      taskId: task.id,
      title: task.title,
      issueType: task.issueType,
      status: task.status,
      description: task.description,
    },
    humanFeedback,
    settings,
  }).prompt;
  const generationModel: AgentTextGenerationInput["model"] = {
    runtimeKind: model.runtimeKind,
    providerId: model.providerId,
    modelId: model.modelId,
  };
  if (model.variant) generationModel.variant = model.variant;
  const { text } = await connectionHost(queryClient).agentRuntimeGenerateText({
    repoPath: workspace.repoPath,
    model: generationModel,
    instructions,
    prompt: goalTaskMaterial({
      task: { id: task.id, title: task.title, description: task.description ?? "" },
      defaultObjective,
      artifacts: documents.filter(({ markdown }) => markdown.trim().length > 0),
    }),
  });
  return text;
};
