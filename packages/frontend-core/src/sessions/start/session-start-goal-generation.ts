import type { TaskCard, WorkspaceRef } from "@openducktor/contracts";
import {
  GOAL_WRITER_INSTRUCTIONS,
  goalWriterPrompt,
  type TaskWorkflow,
} from "@openducktor/workflows";
import type { QueryClient } from "@tanstack/react-query";
import { connectionHost } from "../../connection/client-connection";
import { taskDocumentQueryOptions } from "../../queries/documents";
import type { RuntimeBoundModelSelection } from "../../lib/repo-agent-defaults";

export const GOAL_GENERATION_NEEDS_DEFAULT_MODEL =
  "Set a default model in the repository settings to generate a goal.";

/**
 * Asks the model to write the goal of a launch from the task, its workflow artifacts, and the
 * default goal of the launch. The model gets no tools, so the client sends the task material.
 */
export const generateSessionStartGoal = async ({
  queryClient,
  workspace,
  task,
  taskWorkflow,
  defaultObjective,
  model,
}: {
  queryClient: QueryClient;
  workspace: WorkspaceRef;
  task: Pick<TaskCard, "id" | "title" | "description">;
  taskWorkflow: TaskWorkflow;
  defaultObjective: string;
  model: RuntimeBoundModelSelection;
}): Promise<string> => {
  const documents = await Promise.all(
    taskWorkflow.definition.artifacts.map(async ({ id, label }) => ({
      label,
      markdown: (
        await queryClient.fetchQuery(taskDocumentQueryOptions(queryClient, workspace, task.id, id))
      ).markdown,
    })),
  );
  const generationModel: Parameters<
    ReturnType<typeof connectionHost>["agentRuntimeGenerateText"]
  >[0]["model"] = {
    runtimeKind: model.runtimeKind,
    providerId: model.providerId,
    modelId: model.modelId,
  };
  if (model.variant) generationModel.variant = model.variant;
  const { text } = await connectionHost(queryClient).agentRuntimeGenerateText({
    repoPath: workspace.repoPath,
    model: generationModel,
    instructions: GOAL_WRITER_INSTRUCTIONS,
    prompt: goalWriterPrompt({
      task: { id: task.id, title: task.title, description: task.description ?? "" },
      defaultObjective,
      artifacts: documents.filter(({ markdown }) => markdown.trim().length > 0),
    }),
  });
  return text;
};
