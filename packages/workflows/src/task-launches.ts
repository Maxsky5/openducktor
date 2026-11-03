import type { TaskWorkflow, TaskWorkflowLaunchAction } from "./task-workflow/task-workflow";
import { taskWorkflowInput, type ResolvedTaskCard } from "./task-workflow-view";

const agentStepOfRole = (workflow: TaskWorkflow, role: string) => {
  const step = workflow.agentStep(role);
  if (!step)
    throw new Error(
      `Workflow "${workflow.reference.id}@${workflow.reference.revision}" has no agent step for role "${role}".`,
    );
  return step;
};

/** The launch actions that show as extra controls on a surface for the task. */
export const taskSurfaceLaunches = (
  task: ResolvedTaskCard,
  surface: "studio" | "git_conflict",
): TaskWorkflowLaunchAction[] => {
  const candidates = task.taskWorkflow.surfaceLaunches(surface);
  if (candidates.length === 0) return [];
  const input = taskWorkflowInput(task);
  const available = new Set(
    task.workflowSteps.filter((step) => step.available).map(({ id }) => id),
  );
  return candidates.flatMap(({ launch, stepId, show }) =>
    available.has(stepId) && show(input) ? [launch] : [],
  );
};
export const taskGitConflictLaunch = (task: ResolvedTaskCard): TaskWorkflowLaunchAction | null =>
  taskSurfaceLaunches(task, "git_conflict")[0] ?? null;
/** The pull request launch of the task: the selected one, or the first declared one. */
export const taskPullRequestLaunch = (
  task: ResolvedTaskCard,
  launchActionId?: string,
): TaskWorkflowLaunchAction | null => {
  const launches = task.taskWorkflow.definition.steps.flatMap((step) =>
    step.kind === "agent"
      ? step.launchActions.filter(({ context }) => context === "pull_request")
      : [],
  );
  const launch = launchActionId ? launches.find(({ id }) => id === launchActionId) : launches[0];
  return launch ? task.taskWorkflow.launchAction(launch.id) : null;
};
/** The order of launch candidates: the first matching launch order rule, then declaration order. */
export const taskLaunchOrder = (task: ResolvedTaskCard): readonly string[] => {
  const input = taskWorkflowInput(task);
  const hasPullRequest = !!task.pullRequest;
  return (
    task.taskWorkflow.definition.launchOrder.find(
      (rule) =>
        (rule.pullRequest === undefined || rule.pullRequest === hasPullRequest) &&
        task.taskWorkflow.evaluator.condition(rule.when)(input),
    )?.order ?? []
  );
};
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
  return task.taskWorkflow.evaluator.stepLaunchAction(
    taskWorkflowInput(task),
    agentStepOfRole(task.taskWorkflow, role).id,
  );
};
export const supportsTaskTargetBranchSelection = (
  role: string | null | undefined,
  launchId: string | null | undefined,
  workflow: TaskWorkflow | undefined,
): boolean => {
  if (!launchId || !workflow) return false;
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
    latest: state.historyLatest ?? state.terminal === true,
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
export const roleSettingsLabel = (role: string, workflow: TaskWorkflow): string => {
  const declared = workflow.role(role);
  return declared.settingsLabel ?? declared.label;
};

/** The extra prompt context that a launch collects before it starts. */
export type KickoffPromptContextKind = NonNullable<TaskWorkflowLaunchAction["context"]> | "none";
export const launchPromptContext = (
  launch: Pick<TaskWorkflowLaunchAction, "context">,
): KickoffPromptContextKind => launch.context ?? "none";
/** The icon of a role. A session of a role that the workflow no longer declares has none. */
export const workflowRoleIcon = (workflow: TaskWorkflow, role: string) =>
  workflow.hasRole(role) ? workflow.role(role).icon : undefined;
/** The label of a role. A session of a role that the workflow no longer declares shows its ID. */
export const workflowRoleLabel = (workflow: TaskWorkflow, role: string): string =>
  workflow.hasRole(role) ? workflow.role(role).label : role;
