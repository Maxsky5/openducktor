import {
  EMPTY_PROMPT_SETTINGS,
  launchPromptContext,
  type ResolvedTaskCard as TaskCard,
} from "@openducktor/workflows";
import type { QueryClient } from "@tanstack/react-query";
import { loadPromptSettings } from "../../queries/prompt-settings";
import { loadRepoConfigFromQuery } from "../../queries/workspace";
import type { GitTargetBranch } from "@openducktor/contracts";
import type { PromptSettings } from "@openducktor/workflows";
import { resolveSessionStartKickoffPromptContext } from "./session-start-prompt-context";
import { kickoffPromptForLaunchAction } from "./session-start-prompts";
import type { SessionStartFlowRequest, ResolvedSessionStartDecision } from "./session-start-types";

type KickoffPreview = Pick<
  SessionStartFlowRequest,
  "taskId" | "role" | "launchActionId" | "humanFeedback" | "beforeStartAction"
> &
  Pick<ResolvedSessionStartDecision, "targetBranch" | "kickoffPrompt">;

export type SessionStartKickoffInput = {
  workspaceId: string | null;
  task: TaskCard | null;
  request: KickoffPreview;
};

/**
 * The task that a launch runs on. A launch that follows an event runs in the state that the event
 * gives, so its prompt shows that state.
 */
export const sessionLaunchTask = (
  task: TaskCard,
  beforeStartAction: SessionStartFlowRequest["beforeStartAction"],
): TaskCard =>
  beforeStartAction ? task.taskWorkflow.taskAfterEvent(beforeStartAction.eventId, task) : task;

export const buildSessionStartKickoffPrompt = ({
  intent,
  task,
  settings,
  repoDefaultTargetBranch,
}: {
  intent: KickoffPreview;
  task: TaskCard | null;
  /** The saved prompt layers. */
  settings: PromptSettings;
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
  const launchTask = sessionLaunchTask(task, intent.beforeStartAction);

  return kickoffPromptForLaunchAction(intent.launchActionId, intent.taskId, {
    settings,
    role: intent.role,
    taskWorkflow: task.taskWorkflow,
    ...promptContext,
    task: {
      title: launchTask.title,
      issueType: launchTask.issueType,
      status: launchTask.status,
      description: launchTask.description,
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
  const [repoConfig, settings] = workspaceId
    ? await Promise.all([
        loadRepoConfigFromQuery(queryClient, workspaceId),
        loadPromptSettings(workspaceId, queryClient),
      ])
    : [null, EMPTY_PROMPT_SETTINGS];
  const effectiveTargetBranch = targetBranch ?? task.targetBranch;
  const contextInput: Parameters<typeof resolveSessionStartKickoffPromptContext>[0] = {
    templateId: launch.template.id,
    context: launchPromptContext(launch),
    repoDefaultTargetBranch: repoConfig?.defaultTargetBranch ?? null,
  };
  if (effectiveTargetBranch) contextInput.taskTargetBranch = effectiveTargetBranch;
  if (request.humanFeedback !== undefined) contextInput.message = request.humanFeedback;
  const context = resolveSessionStartKickoffPromptContext(contextInput);
  const launchTask = sessionLaunchTask(task, request.beforeStartAction);
  const message = workflow.prompts.messagePrompt({
    launchActionId: launch.id,
    role: request.role,
    task: {
      taskId: launchTask.id,
      title: launchTask.title,
      issueType: launchTask.issueType,
      status: launchTask.status,
      description: launchTask.description,
    },
    humanFeedback: context.extraPlaceholders?.humanFeedback,
    targetBranch: context.git?.targetBranch,
    settings,
  }).prompt;
  if (!message.trim())
    throw new Error(`Message prompt for launch "${launch.id}" must not be blank.`);
  return { ...request, message };
};
