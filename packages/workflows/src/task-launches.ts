import { TASK_CLOSED_STATE } from "@openducktor/contracts";
import type { TaskWorkflow, TaskWorkflowLaunchAction } from "./task-workflow/task-workflow";
import type { ResolvedTaskCard } from "./task-workflow-view";
import { isPullRequestLaunch } from "./task-workflow/pull-request-launch";

const agentStepOfRole = (workflow: TaskWorkflow, role: string) => {
  const step = workflow.agentStep(role);
  if (!step)
    throw new Error(
      `Workflow "${workflow.reference.id}@${workflow.reference.revision}" has no agent step for role "${role}".`,
    );
  return step;
};

export const taskGitConflictLaunch = (task: ResolvedTaskCard): TaskWorkflowLaunchAction | null =>
  task.taskWorkflow.surfaceLaunches(task, "git_conflict")[0] ?? null;
/** The task sessions that can run the core pull request launch of the task, latest first. */
export const taskPullRequestSessions = <
  Session extends { taskId: string; role: string; startedAt: string },
>(
  task: ResolvedTaskCard,
  sessions: readonly Session[],
): Session[] =>
  sessions
    .filter(({ taskId, role }) => taskId === task.id && task.taskWorkflow.createsPullRequest(role))
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
/** The command kind of a launch: a kickoff starts a session; a message continues one. */
export const launchSessionCommand = (
  launch: Pick<TaskWorkflowLaunchAction, "template">,
): "kickoff" | "send_message" => (launch.template.kind === "kickoff" ? "kickoff" : "send_message");

export const defaultSessionLaunchActionForRole = (role: string, workflow: TaskWorkflow): string =>
  agentStepOfRole(workflow, role).launchActions[0]!.id;
export const resolveSessionContinuationLaunchAction = (
  role: string,
  task: ResolvedTaskCard | null | undefined,
): string => {
  if (!task)
    throw new Error("Task workflow is unavailable. Reload the task before starting a session.");
  return task.taskWorkflow.stepLaunchAction(task, agentStepOfRole(task.taskWorkflow, role).id);
};
export const supportsTaskTargetBranchSelection = (
  role: string | null | undefined,
  launchId: string | null | undefined,
  workflow: TaskWorkflow | undefined,
): boolean => {
  if (!launchId || !workflow || !role) return false;
  if (isPullRequestLaunch(launchId)) return workflow.createsPullRequest(role);
  const launch = workflow.launchAction(launchId);
  return launch.role === role && launch.targetBranch === true;
};
export const resolveAgentStudioDefaultRoleForTask = (
  task: ResolvedTaskCard | null,
): string | null => {
  if (!task) return null;
  const role = task.taskWorkflow.state(task.status).studioRole;
  const step = task.workflowSteps.find(
    (step) => step.kind === "agent" && step.required && step.available,
  );
  return role ?? (step?.kind === "agent" ? step.roleId : null);
};
/** The roles whose latest session Agent Studio opens first, and whether any latest session follows. */
export const taskSessionHistory = (task: ResolvedTaskCard) => {
  const state = task.taskWorkflow.state(task.status);
  const defaultRole = resolveAgentStudioDefaultRoleForTask(task);
  return {
    roles: state.historyRoles ?? (defaultRole ? [defaultRole] : []),
    latest: state.historyLatest ?? task.status === TASK_CLOSED_STATE,
  };
};
/** The document that the role side panel shows first. */
export const roleFocusArtifact = (role: string, workflow: TaskWorkflow): string | undefined => {
  const declared = workflow.role(role).defaultArtifact;
  if (declared) return declared;
  const step = workflow.agentStep(role);
  return step?.outputs[0] ?? step?.inputs.at(-1);
};
export const roleDefaultPanel = (role: string, workflow: TaskWorkflow): "document" | "diffs" =>
  workflow.role(role).defaultPanel ?? "document";

/**
 * The extra prompt context that a launch collects before it starts. The core pull request launch
 * collects the pull request target branch.
 */
export type KickoffPromptContextKind =
  | NonNullable<TaskWorkflowLaunchAction["context"]>
  | "pull_request"
  | "none";
export const launchPromptContext = (
  launch: Pick<TaskWorkflowLaunchAction, "id" | "context">,
): KickoffPromptContextKind =>
  isPullRequestLaunch(launch.id) ? "pull_request" : (launch.context ?? "none");
/**
 * The icon of a session role. It comes from the catalog role, because a moved task can keep
 * sessions of a role that its version does not bind.
 */
export const workflowRoleIcon = (workflow: TaskWorkflow, role: string) =>
  workflow.catalogRole(role)?.icon;
/** The label of a session role, from the catalog role. A role outside the catalog shows its ID. */
export const workflowRoleLabel = (workflow: TaskWorkflow, role: string): string =>
  workflow.catalogRole(role)?.label ?? role;
/** The label of the one pull request role of a workflow, or null when it names zero or several. */
export const pullRequestRoleLabel = (workflow: TaskWorkflow): string | null => {
  const [role, ...others] = workflow.pullRequestRoles;
  return role !== undefined && others.length === 0 ? workflow.role(role).label : null;
};
