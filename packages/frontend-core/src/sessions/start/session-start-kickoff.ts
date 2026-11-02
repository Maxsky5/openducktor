import { getSessionLaunchAction, type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import type { GitTargetBranch, RepoPromptOverrides } from "@openducktor/contracts";
import { resolveSessionStartKickoffPromptContext } from "./session-start-prompt-context";
import { kickoffPromptForTemplate } from "./session-start-prompts";
import type { SessionStartFlowRequest, ResolvedSessionStartDecision } from "./session-start-types";

type KickoffPreview = Pick<
  SessionStartFlowRequest,
  "taskId" | "role" | "launchActionId" | "message"
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
  const launchAction = getSessionLaunchAction(intent.launchActionId);
  const { template } = launchAction;
  if (template.kind !== "kickoff") {
    throw new Error(`Launch action "${intent.launchActionId}" does not define a kickoff prompt.`);
  }
  if (intent.kickoffPrompt !== undefined && !intent.kickoffPrompt.trim()) {
    throw new Error("Enter a first message.");
  }
  const taskTargetBranch = intent.targetBranch ?? task?.targetBranch;
  const promptContextInput: Parameters<typeof resolveSessionStartKickoffPromptContext>[0] = {
    templateId: template.id,
    repoDefaultTargetBranch,
  };

  if (intent.message !== undefined) {
    promptContextInput.message = intent.message;
  }

  if (taskTargetBranch) {
    promptContextInput.taskTargetBranch = taskTargetBranch;
  }

  const promptContext = resolveSessionStartKickoffPromptContext(promptContextInput);
  if (intent.kickoffPrompt !== undefined) return intent.kickoffPrompt;

  return kickoffPromptForTemplate(intent.role, template.id, intent.taskId, {
    overrides,
    ...promptContext,
    task:
      task === null
        ? {}
        : {
            title: task.title,
            issueType: task.issueType,
            status: task.status,
            description: task.description,
          },
  });
};
