import type { RepositoryGitProviderContext } from "@openducktor/contracts";
import { type AgentSessionStartMode } from "@openducktor/core";
import {
  WORKFLOW_QUICK_ACTIONS,
  assertAgentStudioWorkflowQuickAction,
  canShowPullRequestWorkflowQuickAction,
  orderAgentStudioQuickActions,
  resolveTaskCardActions,
  taskActionLabel,
  getSessionLaunchAction,
  AGENT_STUDIO_SESSION_START_ACTIONS,
  type AgentStudioWorkflowQuickAction,
  type BuiltinLaunchActionId as SessionLaunchActionId,
  type BuiltinRoleId as AgentRole,
  type BuiltinTaskCard as TaskCard,
  buildRoleWorkflowMapForTask,
} from "@openducktor/workflows";
import { buildReusableSessionOptions } from "./session-start-reuse-options";
import { type SessionStartExistingSessionOption } from "./session-start-types";
import { type SessionStartPostAction } from "./session-start-workflow";
import { pullRequestHealthError } from "../../review/git-provider-health";
import type { AgentSessionSummary } from "../agent-sessions-store";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";

/** The workflow roles that a task can start now. */
export const buildRoleEnabledMapForTask = (task: TaskCard | null) => {
  const workflowsByRole = buildRoleWorkflowMapForTask(task);
  return {
    spec: workflowsByRole.spec.available,
    planner: workflowsByRole.planner.available,
    build: workflowsByRole.build.available,
    qa: workflowsByRole.qa.available,
  } satisfies Record<AgentRole, boolean>;
};

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
};

export type AgentStudioTaskQuickAction = "human_approve" | "close_task";

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

const AUXILIARY_QUICK_ACTIONS = {
  build_pull_request_generation: {
    role: "build",
    description: "Reuse or fork a Builder session to create or update a pull request.",
    postStartAction: "kickoff",
  },
  build_rebase_conflict_resolution: {
    role: "build",
    description: "Ask Builder to resolve the active git conflict.",
    postStartAction: "send_message",
  },
} as const;

export const SESSION_BUSY_REASON = "Wait for the current session to finish.";

const createQuickActionDisabledReason = (createSessionDisabled: boolean): string | null => {
  return createSessionDisabled ? SESSION_BUSY_REASON : null;
};

const canShowPullRequestQuickAction = (
  task: TaskCard,
  gitProviderContext: RepositoryGitProviderContext | undefined,
  gitProviderReadError: string | null | undefined,
): boolean => {
  const readFailedWithoutContext = gitProviderContext == null && gitProviderReadError != null;
  return (
    canShowPullRequestWorkflowQuickAction(task) &&
    (gitProviderContext?.descriptor.capabilities.supportsPullRequests === true ||
      readFailedWithoutContext)
  );
};

export const buildAgentStudioQuickActions = (params: {
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionSummary[];
  roleEnabledByTask: Record<AgentRole, boolean>;
  createSessionDisabled: boolean;
  gitProviderContext?: RepositoryGitProviderContext | undefined;
  gitProviderReadError?: string | null;
  /** The target that the task branch is merged into. Close Task then leads. */
  mergedTarget?: string | null;
}): AgentStudioQuickActionOption[] => {
  const task = params.selectedTask;
  if (!task) {
    return [];
  }

  const workflowActionOrder = resolveTaskCardActions(task, {
    include: AGENT_STUDIO_SESSION_START_ACTIONS,
    surface: "agent_studio_quick_actions",
  }).allActions.map(assertAgentStudioWorkflowQuickAction);
  const disabledReason = createQuickActionDisabledReason(params.createSessionDisabled);
  const createLifecycleOption = (
    action: AgentStudioWorkflowQuickAction,
  ): AgentStudioSessionQuickActionOption | null => {
    const definition = WORKFLOW_QUICK_ACTIONS[action];
    const launchActionId = definition.resolveLaunchActionId(task);
    const role = definition.role;
    if (!params.roleEnabledByTask[role]) {
      return null;
    }
    const option: AgentStudioSessionQuickActionOption = {
      kind: "session_start",
      id: `quick:${launchActionId}`,
      role,
      launchActionId,
      label: taskActionLabel(action, task, { surface: "agent_studio" }),
      description: definition.description,
      postStartAction: "kickoff",
      disabled: disabledReason !== null,
    };
    if (disabledReason) {
      option.disabledReason = disabledReason;
    }
    if ("requiresHumanFeedback" in definition && definition.requiresHumanFeedback) {
      option.requiresHumanFeedback = true;
    }
    return option;
  };
  const options = workflowActionOrder.reduce<AgentStudioSessionQuickActionOption[]>(
    (nextOptions, action) => {
      const option = createLifecycleOption(action);
      if (option) {
        nextOptions.push(option);
      }
      return nextOptions;
    },
    [],
  );

  if (
    canShowPullRequestQuickAction(task, params.gitProviderContext, params.gitProviderReadError) &&
    params.roleEnabledByTask.build
  ) {
    const builderSessionOptions = buildReusableSessionOptions({
      sessions: params.sessionsForTask.filter((session) => session.taskId === task.id),
      role: "build",
    });
    const hasBuilderSource = builderSessionOptions.length > 0;
    const pullRequestDisabledReason =
      params.gitProviderReadError ??
      pullRequestHealthError(params.gitProviderContext) ??
      disabledReason ??
      (hasBuilderSource ? null : "Requires an existing Builder session.");
    const option: AgentStudioSessionQuickActionOption = {
      kind: "session_start",
      id: "quick:build_pull_request_generation",
      ...AUXILIARY_QUICK_ACTIONS.build_pull_request_generation,
      launchActionId: "build_pull_request_generation",
      label: getSessionLaunchAction("build_pull_request_generation").label,
      disabled: pullRequestDisabledReason !== null,
    };
    if (pullRequestDisabledReason) {
      option.disabledReason = pullRequestDisabledReason;
    }
    if (hasBuilderSource) {
      option.initialStartMode = getSessionLaunchAction(
        "build_pull_request_generation",
      ).defaultStartMode;
      option.existingSessionOptions = builderSessionOptions;
      option.initialSourceSession = builderSessionOptions[0]?.sourceSession ?? null;
    }
    options.push(option);
  }

  return withTaskQuickActions(
    task,
    orderAgentStudioQuickActions(task, options, workflowActionOrder),
    params,
  );
};

/**
 * Builds the action that asks Builder to resolve an active git conflict.
 * The page shell adds it to the header, because the git state comes after the workflow model.
 */
export const buildGitConflictQuickAction = (params: {
  selectedTask: TaskCard | null;
  roleEnabledByTask: Record<AgentRole, boolean>;
  createSessionDisabled: boolean;
}): AgentStudioSessionQuickActionOption | null => {
  if (!params.selectedTask || !params.roleEnabledByTask.build) {
    return null;
  }
  const disabledReason = createQuickActionDisabledReason(params.createSessionDisabled);
  const option: AgentStudioSessionQuickActionOption = {
    kind: "session_start",
    id: "quick:build_rebase_conflict_resolution",
    ...AUXILIARY_QUICK_ACTIONS.build_rebase_conflict_resolution,
    launchActionId: "build_rebase_conflict_resolution",
    label: getSessionLaunchAction("build_rebase_conflict_resolution").label,
    disabled: disabledReason !== null,
  };
  if (disabledReason) {
    option.disabledReason = disabledReason;
  }
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

/**
 * Adds the task actions. Close Task leads for a merged task branch. Approve Task leads a human
 * review without an enabled Git provider, and otherwise follows the session actions.
 */
const withTaskQuickActions = (
  task: TaskCard,
  sessionOptions: AgentStudioSessionQuickActionOption[],
  params: Pick<
    Parameters<typeof buildAgentStudioQuickActions>[0],
    "mergedTarget" | "gitProviderContext" | "gitProviderReadError"
  >,
): AgentStudioQuickActionOption[] => {
  const taskOptions: AgentStudioTaskQuickActionOption[] = [];
  if (params.mergedTarget) {
    taskOptions.push({
      ...taskQuickAction(
        task,
        "close_task",
        "leading",
        `The task branch is merged into ${params.mergedTarget}.`,
      ),
      mergedTarget: params.mergedTarget,
    });
  }
  // The host offers human_approve only for review tasks.
  if (task.availableActions.includes("human_approve")) {
    const leadsReview =
      task.status === "human_review" &&
      hasNoEnabledGitProvider(params.gitProviderContext, params.gitProviderReadError);
    taskOptions.push(
      taskQuickAction(
        task,
        "human_approve",
        leadsReview ? "leading" : "trailing",
        "Open the approval flow to merge, open a pull request, or close the task.",
      ),
    );
  }
  return [
    ...taskOptions.filter((option) => option.placement === "leading"),
    ...sessionOptions,
    ...taskOptions.filter((option) => option.placement === "trailing"),
  ];
};

const taskQuickAction = (
  task: TaskCard,
  taskAction: AgentStudioTaskQuickActionOption["taskAction"],
  placement: AgentStudioTaskQuickActionOption["placement"],
  description: string,
): AgentStudioTaskQuickActionOption => ({
  kind: "task_action",
  id: `task:${taskAction}`,
  taskAction,
  placement,
  label: taskActionLabel(taskAction, task),
  description,
  disabled: false,
});

/** A loaded repository without an enabled Git provider has no pull request flow. */
const hasNoEnabledGitProvider = (
  gitProviderContext: RepositoryGitProviderContext | undefined,
  gitProviderReadError: string | null | undefined,
): boolean =>
  gitProviderReadError == null &&
  gitProviderContext !== undefined &&
  (gitProviderContext === null || !gitProviderContext.config.enabled);
