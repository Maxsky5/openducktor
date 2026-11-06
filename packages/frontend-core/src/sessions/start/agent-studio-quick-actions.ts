import { PULL_REQUEST_LAUNCH_ID, type RepositoryGitProviderContext } from "@openducktor/contracts";
import { type AgentSessionStartMode } from "@openducktor/core";
import {
  actionShowsOn,
  launchSessionCommand,
  pullRequestRoleLabel,
  taskLaunchOrder,
  taskSurfaceLaunches,
  taskWorkflowInput,
  taskActionLabel,
  taskGitConflictLaunch,
  taskWaitsForMergePublication,
  type WorkflowRoleId as AgentRole,
  type WorkflowLaunchActionId as SessionLaunchActionId,
  type ResolvedTaskCard as TaskCard,
} from "@openducktor/workflows";
import {
  buildPullRequestSessionOptions,
  buildReusableSessionOptions,
} from "./session-start-reuse-options";
import { type SessionStartExistingSessionOption } from "./session-start-types";
import { type SessionStartPostAction } from "./session-start-workflow";
import { pullRequestHealthError } from "../../review/git-provider-health";
import {
  canRunCoreTaskActions,
  CLOSE_TASK_ACTION,
  type CoreTaskAction,
} from "../../tasks/workflow/core-task-actions";
import { eventActionStep } from "../../tasks/workflow/task-action-destination";
import type { AgentSessionSummary } from "../agent-sessions-store";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";

/**
 * The workflow roles that a task can start now. While a local direct merge waits for its
 * publication, the host rejects the work of every session, so the task starts none.
 */
export const buildRoleEnabledMapForTask = (task: TaskCard | null): Record<AgentRole, boolean> => {
  const startsSessions = task !== null && !taskWaitsForMergePublication(task);
  return Object.fromEntries(
    Object.entries(task?.agentWorkflows ?? {}).map(([role, state]) => [
      role,
      startsSessions && state.available,
    ]),
  );
};

/** A quick action that starts or continues a role session. */
export type AgentStudioSessionQuickActionOption = {
  kind: "session_start";
  id: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  label: string;
  description?: string;
  postStartAction: SessionStartPostAction;
  disabled: boolean;
  disabledReason?: string;
  initialStartMode?: AgentSessionStartMode;
  existingSessionOptions?: SessionStartExistingSessionOption[];
  initialSourceSession?: AgentSessionIdentity | null;
  requiresHumanFeedback?: boolean;
  surface?: "studio" | "git_conflict";
};

/** A workflow action of the task, or a core task action such as Close Task for a merged branch. */
export type AgentStudioTaskQuickAction =
  | { kind: "workflow"; action: string }
  | { kind: "core"; action: CoreTaskAction };

/** A quick action that opens a task workflow, such as the approval modal. */
export type AgentStudioTaskQuickActionOption = {
  kind: "task_action";
  id: string;
  taskAction: AgentStudioTaskQuickAction;
  /** A leading action comes before the session actions, a trailing one after them. */
  placement: "leading" | "trailing";
  label: string;
  description?: string;
  /** The target that the task branch is merged into. The header shows it beside the action. */
  mergedTarget?: string;
  disabled: boolean;
  disabledReason?: string;
};

export type AgentStudioQuickActionOption =
  | AgentStudioSessionQuickActionOption
  | AgentStudioTaskQuickActionOption;

export const SESSION_BUSY_REASON = "Wait for the current session to finish.";

type QuickActionParams = {
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionSummary[];
  roleEnabledByTask: Record<AgentRole, boolean>;
  createSessionDisabled: boolean;
  gitProviderContext?: RepositoryGitProviderContext | undefined;
  gitProviderReadError?: string | null;
  mergedTarget?: string | null;
};

export const buildAgentStudioQuickActions = (
  params: QuickActionParams,
): AgentStudioQuickActionOption[] => {
  const task = params.selectedTask;
  if (!task) return [];
  const { evaluator } = task.taskWorkflow;
  const input = taskWorkflowInput(task);
  const options: AgentStudioSessionQuickActionOption[] = [];
  const availableSteps = new Set(
    task.workflowSteps.filter(({ available }) => available).map(({ id }) => id),
  );
  const append = (launchId: string, label?: string, actionDescription?: string) => {
    if (options.some((option) => option.launchActionId === launchId)) return;
    const launch = task.taskWorkflow.launchAction(launchId);
    if (!params.roleEnabledByTask[launch.role]) return;
    const sources = buildReusableSessionOptions({
      sessions: params.sessionsForTask.filter((session) => session.taskId === task.id),
      role: launch.role,
      roleLabel: task.taskWorkflow.role(launch.role).label,
    });
    const reason = params.createSessionDisabled ? SESSION_BUSY_REASON : null;
    const option: AgentStudioSessionQuickActionOption = {
      kind: "session_start",
      id: `quick:${launch.id}`,
      role: launch.role,
      launchActionId: launch.id,
      label: label ?? launch.label,
      postStartAction: launchSessionCommand(launch),
      disabled: reason !== null,
      requiresHumanFeedback: launch.context === "human_feedback",
      surface: "studio",
    };
    const description = launch.description ?? actionDescription;
    if (description) option.description = description;
    if (reason) option.disabledReason = reason;
    if (sources.length && launch.startModes.some((mode) => mode !== "fresh")) {
      option.existingSessionOptions = sources;
      option.initialSourceSession = sources[0]!.sourceSession;
      option.initialStartMode = launch.defaultStartMode;
    }
    options.push(option);
  };
  const launchActions = task.taskWorkflow.definition.actions.filter(
    (action) =>
      action.kind === "session" && action.stepId !== undefined && availableSteps.has(action.stepId),
  );
  const actionById = new Map(launchActions.map((action) => [action.id, action]));
  const launchActionIds = new Set(actionById.keys());
  for (const id of evaluator.orderActions(input, [...launchActionIds])) {
    append(
      evaluator.actionLaunchAction(input, id),
      taskActionLabel(id, task, { surface: "studio" }),
      actionById.get(id)?.description,
    );
  }
  // One record per available task action. An event action whose following launch collects human
  // feedback places itself among the session starts, and its launches leave the step starts.
  const taskEntries = evaluator
    .orderActions(input, task.availableActions)
    .filter((id) => !launchActionIds.has(id))
    .map((id) => {
      const action = task.taskWorkflow.action(id);
      const feedback = eventActionStep(task.taskWorkflow, id) === "feedback";
      const followingLaunches =
        feedback && action.kind === "event" ? (action.launchActionIds ?? []) : [];
      return { id, action, feedback, follows: followingLaunches.length > 0, followingLaunches };
    });
  const effectLaunches = new Set(taskEntries.flatMap(({ followingLaunches }) => followingLaunches));
  for (const step of task.taskWorkflow.definition.steps) {
    if (step.kind !== "agent" || !availableSteps.has(step.id)) continue;
    const launch = evaluator.stepLaunchAction(input, step.id);
    if (!effectLaunches.has(launch)) append(launch);
  }
  for (const launch of taskSurfaceLaunches(task, "studio")) append(launch.id);
  const pullRequestOption = buildPullRequestQuickAction(task, params);
  if (pullRequestOption) options.push(pullRequestOption);
  const leading: AgentStudioTaskQuickActionOption[] = [];
  const following: AgentStudioTaskQuickActionOption[] = [];
  const trailing: AgentStudioTaskQuickActionOption[] = [];
  // A merged task branch proposes the core Close Task before every other action.
  if (params.mergedTarget && canRunCoreTaskActions(task))
    leading.push({
      kind: "task_action",
      id: `task:${CLOSE_TASK_ACTION.id}`,
      taskAction: { kind: "core", action: CLOSE_TASK_ACTION },
      placement: "leading",
      label: CLOSE_TASK_ACTION.label,
      description: `The task branch is merged into ${params.mergedTarget}.`,
      mergedTarget: params.mergedTarget,
      disabled: false,
    });
  for (const { id, action, feedback, follows } of taskEntries) {
    if (!actionShowsOn(action, "studio")) continue;
    const approvalLeads =
      action.kind === "approval" &&
      hasNoEnabledGitProvider(params.gitProviderContext, params.gitProviderReadError);
    const placement = approvalLeads || feedback ? "leading" : "trailing";
    const option: AgentStudioTaskQuickActionOption = {
      kind: "task_action",
      id: `task:${id}`,
      taskAction: { kind: "workflow", action: id },
      placement,
      label: taskActionLabel(id, task, { surface: "studio" }),
      disabled: follows && params.createSessionDisabled,
    };
    if (action.description) option.description = action.description;
    if (option.disabled) option.disabledReason = SESSION_BUSY_REASON;
    if (follows) following.push(option);
    else if (placement === "leading") leading.push(option);
    else trailing.push(option);
  }
  const launchOrder = taskLaunchOrder(task);
  const rank = (option: AgentStudioQuickActionOption) => {
    let id = "";
    if (option.kind === "session_start") id = option.launchActionId;
    else if (option.taskAction.kind === "workflow")
      id = evaluator.actionLaunchAction(input, option.taskAction.action);
    const index = launchOrder.indexOf(id);
    return index < 0 ? launchOrder.length : index;
  };
  const ordered = [...options, ...following].sort((left, right) => rank(left) - rank(right));
  return [...leading, ...ordered, ...trailing];
};

const pullRequestSessionRequiredReason = (roleLabel: string | null): string =>
  roleLabel
    ? `Requires an existing ${roleLabel} session.`
    : "Requires an existing session that can create the pull request.";

/**
 * The core pull request launch, while the task approval is available and the Git provider
 * supports pull requests. The latest session that can create the pull request gives its role.
 */
const buildPullRequestQuickAction = (
  task: TaskCard,
  params: QuickActionParams,
): AgentStudioSessionQuickActionOption | null => {
  const { taskWorkflow } = task;
  if (!taskWorkflow.pullRequestLaunchAvailable(task) || taskWaitsForMergePublication(task))
    return null;
  if (
    params.gitProviderContext?.descriptor.capabilities.supportsPullRequests === false ||
    (!params.gitProviderContext && !params.gitProviderReadError)
  )
    return null;
  const sources = buildPullRequestSessionOptions({ task, sessions: params.sessionsForTask });
  const role = sources[0]?.role ?? taskWorkflow.pullRequestRoles[0];
  if (role === undefined) return null;
  const launch = taskWorkflow.launchAction(PULL_REQUEST_LAUNCH_ID, role);
  const roleLabel = pullRequestRoleLabel(taskWorkflow);
  const reason =
    params.gitProviderReadError ??
    pullRequestHealthError(params.gitProviderContext) ??
    (params.createSessionDisabled ? SESSION_BUSY_REASON : null) ??
    (sources.length ? null : pullRequestSessionRequiredReason(roleLabel));
  const option: AgentStudioSessionQuickActionOption = {
    kind: "session_start",
    id: `quick:${launch.id}`,
    role: launch.role,
    launchActionId: launch.id,
    label: launch.label,
    postStartAction: launchSessionCommand(launch),
    disabled: reason !== null,
    requiresHumanFeedback: false,
    surface: "studio",
  };
  if (launch.description) option.description = launch.description;
  if (reason) option.disabledReason = reason;
  if (sources.length) {
    option.existingSessionOptions = sources;
    option.initialSourceSession = sources[0]!.sourceSession;
    option.initialStartMode = launch.defaultStartMode;
  }
  return option;
};

export const buildGitConflictQuickAction = (params: {
  selectedTask: TaskCard | null;
  roleEnabledByTask: Record<AgentRole, boolean>;
  createSessionDisabled: boolean;
}): AgentStudioSessionQuickActionOption | null => {
  const task = params.selectedTask;
  if (!task) return null;
  const launch = taskGitConflictLaunch(task);
  if (!launch) return null;
  if (!params.roleEnabledByTask[launch.role]) return null;
  const option: AgentStudioSessionQuickActionOption = {
    kind: "session_start",
    surface: "git_conflict",
    id: `quick:${launch.id}`,
    role: launch.role,
    launchActionId: launch.id,
    label: launch.label,
    postStartAction: "send_message",
    disabled: params.createSessionDisabled,
  };
  if (launch.description) option.description = launch.description;
  if (params.createSessionDisabled) option.disabledReason = SESSION_BUSY_REASON;
  return option;
};

/** Puts the git conflict action first, so it becomes the primary action while it is enabled. */
export const withGitConflictQuickAction = (
  quickActions: AgentStudioQuickActionOption[],
  gitConflictQuickAction: AgentStudioQuickActionOption,
) => {
  const options = [gitConflictQuickAction, ...quickActions];
  return {
    quickActions: options,
    primaryQuickAction: selectPrimaryAgentStudioQuickAction(options),
  };
};

/**
 * The primary action is the first enabled option. A trailing task action leads only when no other
 * option exists, so a busy session does not move the primary action.
 */
export const selectPrimaryAgentStudioQuickAction = (
  options: AgentStudioQuickActionOption[],
): AgentStudioQuickActionOption | null => {
  const leadingOptions = options.filter(
    (option) => option.kind === "session_start" || option.placement === "leading",
  );
  const candidates = leadingOptions.length > 0 ? leadingOptions : options;
  return candidates.find((option) => !option.disabled) ?? candidates[0] ?? null;
};

/** A loaded repository without an enabled Git provider has no pull request flow. */
const hasNoEnabledGitProvider = (
  gitProviderContext: RepositoryGitProviderContext | undefined,
  gitProviderReadError: string | null | undefined,
): boolean =>
  gitProviderReadError == null &&
  gitProviderContext !== undefined &&
  (gitProviderContext === null || !gitProviderContext.config.enabled);
