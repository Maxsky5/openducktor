import type { RepoPromptOverrides } from "@openducktor/contracts";
import {
  type BuildAgentKickoffPromptInput,
  type WorkflowIssueTypeId as IssueType,
  type WorkflowLaunchActionId as SessionLaunchActionId,
} from "@openducktor/workflows";

type TaskPromptContext = {
  title?: string;
  issueType?: IssueType;
  status?: string;
  description?: string;
};

type SharedPromptOptions = {
  taskWorkflow: import("@openducktor/workflows").TaskWorkflow;
  /** The role of the session. The core pull request launch needs it. */
  role?: string;
  overrides?: RepoPromptOverrides;
  task?: TaskPromptContext;
};

type SessionStartKickoffPromptOptions = SharedPromptOptions & {
  git?: BuildAgentKickoffPromptInput["git"];
  extraPlaceholders?: BuildAgentKickoffPromptInput["extraPlaceholders"];
};

/** The kickoff prompt of a launch action, with the effective prompt overrides. */
export const kickoffPromptForLaunchAction = (
  launchActionId: SessionLaunchActionId,
  taskId: string,
  options: SessionStartKickoffPromptOptions,
): string =>
  options.taskWorkflow.prompts.kickoffPrompt({
    launchActionId,
    role: options.role,
    task: { taskId, ...options.task },
    overrides: options.overrides,
    humanFeedback: options.extraPlaceholders?.humanFeedback,
    targetBranch: options.git?.targetBranch,
  }).prompt;
