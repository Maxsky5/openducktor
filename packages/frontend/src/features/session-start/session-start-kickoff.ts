import type { TaskCard } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { loadEffectivePromptOverrides } from "@/state/operations/prompt-overrides";
import { loadRepoConfigFromQuery } from "@/state/queries/workspace";
import { getSessionLaunchAction } from "./session-start-launch-options";
import { resolveSessionStartKickoffPromptContext } from "./session-start-prompt-context";
import { kickoffPromptForTemplate } from "./session-start-prompts";
import type { SessionStartFlowRequest, ResolvedSessionStartDecision } from "./session-start-types";

type KickoffPreview = Pick<
  SessionStartFlowRequest,
  "taskId" | "role" | "launchActionId" | "message"
> &
  Pick<ResolvedSessionStartDecision, "targetBranch" | "kickoffPrompt">;

export const resolveSessionStartKickoff = async ({
  queryClient,
  intent,
  task,
  workspaceId,
}: {
  queryClient: QueryClient;
  intent: KickoffPreview;
  task: TaskCard | null;
  workspaceId: string | null;
}): Promise<string> => {
  const launchAction = getSessionLaunchAction(intent.launchActionId);
  const kickoffTemplateId = launchAction.kickoffTemplateId;
  if (!kickoffTemplateId) {
    throw new Error(`Launch action "${intent.launchActionId}" does not define a kickoff prompt.`);
  }
  if (intent.kickoffPrompt !== undefined && !intent.kickoffPrompt.trim()) {
    throw new Error("Kickoff prompt must not be blank.");
  }
  const taskTargetBranch = intent.targetBranch ?? task?.targetBranch;
  const promptContextInput: Parameters<typeof resolveSessionStartKickoffPromptContext>[0] = {
    templateId: kickoffTemplateId,
    loadRepoDefaultTargetBranch: async () => {
      if (!workspaceId) {
        return null;
      }
      return (await loadRepoConfigFromQuery(queryClient, workspaceId)).defaultTargetBranch;
    },
  };

  if (intent.message !== undefined) {
    promptContextInput.message = intent.message;
  }

  if (taskTargetBranch) {
    promptContextInput.taskTargetBranch = taskTargetBranch;
  }

  const promptContext = await resolveSessionStartKickoffPromptContext(promptContextInput);
  if (intent.kickoffPrompt !== undefined) return intent.kickoffPrompt;

  const promptOverrides = workspaceId
    ? await loadEffectivePromptOverrides(workspaceId, queryClient)
    : undefined;

  return kickoffPromptForTemplate(intent.role, kickoffTemplateId, intent.taskId, {
    overrides: promptOverrides ?? {},
    ...promptContext,
    task:
      task === null
        ? {}
        : {
            title: task.title,
            issueType: task.issueType,
            status: task.status,
            qaRequired: task.aiReviewEnabled,
            description: task.description,
          },
  });
};

export const createSessionStartKickoffResolver = ({
  queryClient,
  workspaceId,
  task,
  request,
}: {
  queryClient: QueryClient;
  workspaceId: string | null;
  task: TaskCard | null;
  request: Pick<
    SessionStartFlowRequest,
    "taskId" | "role" | "launchActionId" | "message" | "postStartAction"
  >;
}):
  | ((targetBranch?: import("@openducktor/contracts").GitTargetBranch) => Promise<string>)
  | undefined => {
  if (request.postStartAction !== "kickoff") return undefined;
  return (targetBranch) => {
    const intent: Parameters<typeof resolveSessionStartKickoff>[0]["intent"] = { ...request };
    if (targetBranch) intent.targetBranch = targetBranch;
    return resolveSessionStartKickoff({ queryClient, workspaceId, task, intent });
  };
};
