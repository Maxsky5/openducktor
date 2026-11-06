import { type ResolvedTaskCard as TaskCard, launchPromptContext } from "@openducktor/workflows";
import type { QueryClient } from "@tanstack/react-query";
import { loadEffectivePromptOverrides } from "../../queries/prompt-overrides";
import { loadRepoConfigFromQuery } from "../../queries/workspace";
import type { GitTargetBranch, RepoPromptOverrides } from "@openducktor/contracts";
import { resolveSessionStartKickoffPromptContext } from "./session-start-prompt-context";
import { kickoffPromptForLaunchAction } from "./session-start-prompts";
import type { SessionStartFlowRequest, ResolvedSessionStartDecision } from "./session-start-types";

type KickoffPreview = Pick<
  SessionStartFlowRequest,
  "taskId" | "role" | "launchActionId" | "humanFeedback"
> &
  Pick<ResolvedSessionStartDecision, "targetBranch" | "kickoffPrompt">;

export type SessionStartKickoffInput = {
  workspaceId: string | null;
  task: TaskCard | null;
  request: KickoffPreview;
};

export const buildSessionStartKickoffPrompt = ({
  intent,
  task,
  overrides,
  repoDefaultTargetBranch,
}: {
  intent: KickoffPreview;
  task: TaskCard | null;
  overrides: RepoPromptOverrides;
  repoDefaultTargetBranch: GitTargetBranch | null;
}): string => {
  if (!task)
    throw new Error("Task workflow is unavailable. Reload the task before preparing a prompt.");
  const launchAction = task.taskWorkflow.launchAction(intent.launchActionId, intent.role);
  const { template } = launchAction;
  if (template.kind !== "kickoff") {
    throw new Error(`Launch action "${intent.launchActionId}" does not define a kickoff prompt.`);
  }
  if (intent.kickoffPrompt !== undefined && !intent.kickoffPrompt.trim()) {
    throw new Error("Enter a first message.");
  }
  const taskTargetBranch = intent.targetBranch ?? task.targetBranch;
  const promptContextInput: Parameters<typeof resolveSessionStartKickoffPromptContext>[0] = {
    templateId: template.id,
    context: launchPromptContext(launchAction),
    repoDefaultTargetBranch,
  };

  if (intent.humanFeedback !== undefined) {
    promptContextInput.message = intent.humanFeedback;
  }

  if (taskTargetBranch) {
    promptContextInput.taskTargetBranch = taskTargetBranch;
  }

  const promptContext = resolveSessionStartKickoffPromptContext(promptContextInput);
  if (intent.kickoffPrompt !== undefined) return intent.kickoffPrompt;

  return kickoffPromptForLaunchAction(intent.launchActionId, intent.taskId, {
    overrides,
    role: intent.role,
    taskWorkflow: task.taskWorkflow,
    ...promptContext,
    task: {
      title: task.title,
      issueType: task.issueType,
      status: task.status,
      description: task.description,
    },
  });
};
/** Message launches without an explicit instruction use their declared template and context. */
export const prepareSessionStartInstruction = async ({
  queryClient,
  workspaceId,
  task,
  request,
  targetBranch,
}: {
  queryClient: QueryClient;
  workspaceId: string | null;
  task: TaskCard | null;
  request: SessionStartFlowRequest;
  targetBranch?: import("@openducktor/contracts").GitTargetBranch | undefined;
}): Promise<SessionStartFlowRequest> => {
  if (!task)
    throw new Error("Task workflow is unavailable. Reload the task before preparing a prompt.");
  const launch = task.taskWorkflow.launchAction(request.launchActionId, request.role);
  if (
    request.postStartAction !== "send_message" ||
    request.message !== undefined ||
    request.parts !== undefined
  )
    return request;
  const workflow = task.taskWorkflow;
  const [repoConfig, overrides] = workspaceId
    ? await Promise.all([
        loadRepoConfigFromQuery(queryClient, workspaceId),
        loadEffectivePromptOverrides(workspaceId, queryClient, workflow),
      ])
    : [null, {}];
  const effectiveTargetBranch = targetBranch ?? task.targetBranch;
  const contextInput: Parameters<typeof resolveSessionStartKickoffPromptContext>[0] = {
    templateId: launch.template.id,
    context: launchPromptContext(launch),
    repoDefaultTargetBranch: repoConfig?.defaultTargetBranch ?? null,
  };
  if (effectiveTargetBranch) contextInput.taskTargetBranch = effectiveTargetBranch;
  if (request.humanFeedback !== undefined) contextInput.message = request.humanFeedback;
  const context = resolveSessionStartKickoffPromptContext(contextInput);
  const message = workflow.prompts.messagePrompt({
    launchActionId: launch.id,
    role: request.role,
    task: {
      taskId: task.id,
      title: task.title,
      issueType: task.issueType,
      status: task.status,
      description: task.description,
    },
    humanFeedback: context.extraPlaceholders?.humanFeedback,
    targetBranch: context.git?.targetBranch,
    overrides,
  }).prompt;
  if (!message.trim())
    throw new Error(`Message prompt for launch "${launch.id}" must not be blank.`);
  return { ...request, message };
};
