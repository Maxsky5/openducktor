import type { RepositoryGitProviderContext } from "@openducktor/contracts";
import { type AgentSessionStartMode } from "@openducktor/core";
import {
  actionShowsOn,
  launchSessionCommand,
  taskLaunchOrder,
  taskSurfaceLaunches,
  taskWorkflowInput,
  taskActionLabel,
  taskGitConflictLaunch,
  type WorkflowRoleId as AgentRole,
  type WorkflowLaunchActionId as SessionLaunchActionId,
  type ResolvedTaskCard as TaskCard,
} from "@openducktor/workflows";
import { buildReusableSessionOptions } from "./session-start-reuse-options";
import { type SessionStartExistingSessionOption } from "./session-start-types";
import { type SessionStartPostAction } from "./session-start-workflow";
import { pullRequestHealthError } from "../../review/git-provider-health";
import type { AgentSessionSummary } from "../agent-sessions-store";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";

/** The workflow roles that a task can start now. */
export const buildRoleEnabledMapForTask = (task: TaskCard | null): Record<AgentRole, boolean> =>
  Object.fromEntries(
    Object.entries(task?.agentWorkflows ?? {}).map(([role, state]) => [role, state.available]),
  );

/** A quick action that starts or continues a role session. */
export type AgentStudioSessionQuickActionOption = {
  kind: "session_start";
  id: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  label: string;
  description: string;
  postStartAction: SessionStartPostAction;
  disabled: boolean;
  disabledReason?: string;
  initialStartMode?: AgentSessionStartMode;
  existingSessionOptions?: SessionStartExistingSessionOption[];
  initialSourceSession?: AgentSessionIdentity | null;
  requiresHumanFeedback?: boolean;
  surface?: "studio" | "git_conflict";
};

export type AgentStudioTaskQuickAction = string;

/** A quick action that opens a task workflow, such as the approval modal. */
export type AgentStudioTaskQuickActionOption = {
  kind: "task_action";
  id: string;
  taskAction: AgentStudioTaskQuickAction;
  /** A leading action comes before the session actions, a trailing one after them. */
  placement: "leading" | "trailing";
  label: string;
  description: string;
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
  const append = (launchId: string, label?: string) => {
    if (options.some((option) => option.launchActionId === launchId)) return;
    const launch = task.taskWorkflow.launchAction(launchId);
    if (!params.roleEnabledByTask[launch.role]) return;
    const sources = buildReusableSessionOptions({
      sessions: params.sessionsForTask.filter((session) => session.taskId === task.id),
      role: launch.role,
      roleLabel: task.taskWorkflow.role(launch.role).label,
    });
    let reason = params.createSessionDisabled ? SESSION_BUSY_REASON : null;
    if (launch.context === "pull_request") {
      if (
        params.gitProviderContext?.descriptor.capabilities.supportsPullRequests === false ||
        (!params.gitProviderContext && !params.gitProviderReadError)
      )
        return;
      reason =
        params.gitProviderReadError ??
        pullRequestHealthError(params.gitProviderContext) ??
        reason ??
        (sources.length || launch.startModes.includes("fresh")
          ? null
          : `Requires an existing ${task.taskWorkflow.role(launch.role).label} session.`);
    }
    const option: AgentStudioSessionQuickActionOption = {
      kind: "session_start",
      id: `quick:${launch.id}`,
      role: launch.role,
      launchActionId: launch.id,
      label: label ?? launch.label,
      description: launch.description ?? launch.label,
      postStartAction: launchSessionCommand(launch),
      disabled: reason !== null,
      requiresHumanFeedback: launch.context === "human_feedback",
      surface: "studio",
    };
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
    );
  }
  // One record per available task action. Request Changes with following launches places itself
  // among the session starts, and its launches leave the step starts.
  const taskEntries = evaluator
    .orderActions(input, task.availableActions)
    .filter((id) => !launchActionIds.has(id))
    .map((id) => {
      const action = task.taskWorkflow.action(id);
      const effect = task.taskWorkflow.actionEffect(id);
      const followingLaunches =
        effect === "review.request_changes" && action.kind === "event"
          ? (action.launchActionIds ?? [])
          : [];
      return { id, action, effect, follows: followingLaunches.length > 0, followingLaunches };
    });
  const effectLaunches = new Set(taskEntries.flatMap(({ followingLaunches }) => followingLaunches));
  for (const step of task.taskWorkflow.definition.steps) {
    if (step.kind !== "agent" || !availableSteps.has(step.id)) continue;
    const launch = evaluator.stepLaunchAction(input, step.id);
    if (!effectLaunches.has(launch)) append(launch);
  }
  for (const launch of taskSurfaceLaunches(task, "studio")) append(launch.id);
  const leading: AgentStudioTaskQuickActionOption[] = [];
  const following: AgentStudioTaskQuickActionOption[] = [];
  const trailing: AgentStudioTaskQuickActionOption[] = [];
  for (const { id, action, effect, follows } of taskEntries) {
    const merged = effect === "task.close" && !!params.mergedTarget;
    if (!actionShowsOn(action, "studio") && !merged) continue;
    const approvalLeads =
      effect === "review.approve" &&
      hasNoEnabledGitProvider(params.gitProviderContext, params.gitProviderReadError);
    const placement =
      merged || approvalLeads || effect === "review.request_changes" ? "leading" : "trailing";
    const option: AgentStudioTaskQuickActionOption = {
      kind: "task_action",
      id: `task:${id}`,
      taskAction: id,
      placement,
      label: taskActionLabel(id, task, { surface: "studio" }),
      description: merged ? `The task branch is merged into ${params.mergedTarget}.` : action.label,
      disabled: follows && params.createSessionDisabled,
    };
    if (merged) option.mergedTarget = params.mergedTarget!;
    if (follows) following.push(option);
    else if (placement === "leading") leading.push(option);
    else trailing.push(option);
  }
  const launchOrder = taskLaunchOrder(task);
  const rank = (option: AgentStudioQuickActionOption) => {
    const id =
      option.kind === "session_start"
        ? option.launchActionId
        : evaluator.actionLaunchAction(input, option.taskAction);
    const index = launchOrder.indexOf(id);
    return index < 0 ? launchOrder.length : index;
  };
  const ordered = [...options, ...following].sort((left, right) => rank(left) - rank(right));
  return [...leading, ...ordered, ...trailing];
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
    description: launch.description ?? launch.label,
    postStartAction: "send_message",
    disabled: params.createSessionDisabled,
  };
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
