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

export type AgentStudioQuickActionOption = {
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

export const selectPrimaryAgentStudioQuickAction = <Option extends { disabled: boolean }>(
  options: Option[],
): Option | null => options.find((option) => !option.disabled) ?? options[0] ?? null;

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
  ): AgentStudioQuickActionOption | null => {
    const definition = WORKFLOW_QUICK_ACTIONS[action];
    const launchActionId = definition.resolveLaunchActionId(task);
    const role = definition.role;
    if (!params.roleEnabledByTask[role]) {
      return null;
    }
    const option: AgentStudioQuickActionOption = {
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
  const options = workflowActionOrder.reduce<AgentStudioQuickActionOption[]>(
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
    const option: AgentStudioQuickActionOption = {
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

  return orderAgentStudioQuickActions(task, options, workflowActionOrder);
};

/**
 * Builds the action that asks Builder to resolve an active git conflict.
 * The page shell adds it to the header, because the git state comes after the workflow model.
 */
export const buildGitConflictQuickAction = (params: {
  selectedTask: TaskCard | null;
  roleEnabledByTask: Record<AgentRole, boolean>;
  createSessionDisabled: boolean;
}): AgentStudioQuickActionOption | null => {
  if (!params.selectedTask || !params.roleEnabledByTask.build) {
    return null;
  }
  const disabledReason = createQuickActionDisabledReason(params.createSessionDisabled);
  const option: AgentStudioQuickActionOption = {
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
