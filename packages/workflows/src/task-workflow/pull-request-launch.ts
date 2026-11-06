import {
  PULL_REQUEST_LAUNCH_ID,
  WORKFLOW_PROMPT_IDS,
  type WorkflowLaunchActionDefinition,
} from "@openducktor/contracts";
import { deepFreeze } from "../deep-freeze";

/**
 * The core pull request launch. It continues or forks a session of a pull request role in the
 * task worktree, and sends the `messages.pull_request` prompt of the workflow with the task
 * target branch.
 */
export const PULL_REQUEST_LAUNCH = deepFreeze({
  id: PULL_REQUEST_LAUNCH_ID,
  label: "Generate Pull Request",
  startModes: ["reuse", "fork"],
  defaultStartMode: "reuse",
  template: { kind: "kickoff", id: WORKFLOW_PROMPT_IDS.pullRequest },
  targetBranch: true,
  requiresWorktree: true,
  description: "Generate or update the pull request.",
} satisfies WorkflowLaunchActionDefinition);

/** Whether a launch action ID names the core pull request launch. */
export const isPullRequestLaunch = (launchActionId: string): boolean =>
  launchActionId === PULL_REQUEST_LAUNCH_ID;
