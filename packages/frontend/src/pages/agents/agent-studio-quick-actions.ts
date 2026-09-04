import type { RepositoryGitProviderContext, TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentSessionStartMode } from "@openducktor/core";
import { resolveTaskCardActions } from "@/components/features/kanban/kanban-task-workflow";
import { taskActionLabel } from "@/components/features/kanban/task-action-ui";
import {
  buildReusableSessionOptions,
  getSessionLaunchAction,
  LAUNCH_ACTION_LABELS,
  type SessionLaunchActionId,
  type SessionStartExistingSessionOption,
  type SessionStartPostAction,
} from "@/features/session-start";
import {
  AGENT_STUDIO_SESSION_START_ACTIONS,
  type AgentStudioWorkflowQuickAction,
  type TaskWorkflowAction,
} from "@/features/task-workflow/task-workflow-actions";
import { pullRequestHealthError } from "@/lib/git-provider-health";
import { isQaRejectedTask } from "@/lib/task-qa";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

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

type WorkflowQuickActionDefinition = {
  role: AgentRole;
  resolveLaunchActionId: (task: TaskCard) => SessionLaunchActionId;
  description: string;
  requiresHumanFeedback?: true;
};

const WORKFLOW_QUICK_ACTIONS = {
  set_spec: {
    role: "spec",
    resolveLaunchActionId: () => "spec_initial",
    description: "Open the start-session flow for the Spec workflow.",
  },
  set_plan: {
    role: "planner",
    resolveLaunchActionId: () => "planner_initial",
    description: "Open the start-session flow for the Planner workflow.",
  },
  build_start: {
    role: "build",
    resolveLaunchActionId: (task) =>
      isQaRejectedTask(task) ? "build_after_qa_rejected" : "build_implementation_start",
    description: "Open the start-session flow for Builder implementation work.",
  },
  qa_start: {
    role: "qa",
    resolveLaunchActionId: () => "qa_review",
    description: "Open the start-session flow for QA review.",
  },
  human_request_changes: {
    role: "build",
    resolveLaunchActionId: () => "build_after_human_request_changes",
    description: "Collect human feedback, then open the Builder rework flow.",
    requiresHumanFeedback: true,
  },
} satisfies Record<AgentStudioWorkflowQuickAction, WorkflowQuickActionDefinition>;

const WORKFLOW_QUICK_ACTION_KEYS = new Set<string>(Object.keys(WORKFLOW_QUICK_ACTIONS));

const isAgentStudioWorkflowQuickAction = (
  action: TaskWorkflowAction,
): action is AgentStudioWorkflowQuickAction => WORKFLOW_QUICK_ACTION_KEYS.has(action);

const assertAgentStudioWorkflowQuickAction = (
  action: TaskWorkflowAction,
): AgentStudioWorkflowQuickAction => {
  if (isAgentStudioWorkflowQuickAction(action)) {
    return action;
  }
  throw new Error(`Unsupported Agent Studio quick action workflow action: ${action}`);
};

const createQuickActionDisabledReason = (createSessionDisabled: boolean): string | null => {
  return createSessionDisabled ? "Wait for the current session to finish." : null;
};

const PULL_REQUEST_QUICK_ACTION_STATUSES = new Set<TaskCard["status"]>(["human_review"]);

const canShowPullRequestQuickAction = (
  task: TaskCard,
  gitProviderContext: RepositoryGitProviderContext | undefined,
): boolean => {
  return (
    PULL_REQUEST_QUICK_ACTION_STATUSES.has(task.status) &&
    gitProviderContext?.descriptor.capabilities.supportsPullRequests === true
  );
};

const hasLinkedPullRequest = (task: TaskCard): boolean => {
  return task.pullRequest !== undefined;
};

const quickActionIdForWorkflowAction = (
  action: AgentStudioWorkflowQuickAction,
  task: TaskCard,
): SessionLaunchActionId => WORKFLOW_QUICK_ACTIONS[action].resolveLaunchActionId(task);

const orderQuickActions = (
  task: TaskCard,
  options: AgentStudioQuickActionOption[],
  workflowActionOrder: readonly AgentStudioWorkflowQuickAction[],
): AgentStudioQuickActionOption[] => {
  const orderedWorkflowLaunchActions = workflowActionOrder.map((action) =>
    quickActionIdForWorkflowAction(action, task),
  );

  const launchActionPriority = new Map(
    orderedWorkflowLaunchActions.map((launchActionId, index) => [launchActionId, index]),
  );
  if (task.status === "human_review") {
    const primaryReviewLaunchAction = hasLinkedPullRequest(task)
      ? "build_after_human_request_changes"
      : "build_pull_request_generation";
    launchActionPriority.set(primaryReviewLaunchAction, -1);
  }
  const fallbackPriority = launchActionPriority.size + 1;

  return options.toSorted((left, right) => {
    if (left.launchActionId === "build_rebase_conflict_resolution") {
      return -1;
    }
    if (right.launchActionId === "build_rebase_conflict_resolution") {
      return 1;
    }

    const leftPriority = launchActionPriority.get(left.launchActionId) ?? fallbackPriority;
    const rightPriority = launchActionPriority.get(right.launchActionId) ?? fallbackPriority;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return 0;
  });
};

export const buildAgentStudioQuickActions = (params: {
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionSummary[];
  roleEnabledByTask: Record<AgentRole, boolean>;
  createSessionDisabled: boolean;
  hasActiveGitConflict?: boolean;
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
  const createSpecialOption = (
    id: string,
    role: AgentRole,
    launchActionId: SessionLaunchActionId,
    description: string,
  ): AgentStudioQuickActionOption => {
    const option: AgentStudioQuickActionOption = {
      id,
      role,
      launchActionId,
      label: LAUNCH_ACTION_LABELS[launchActionId],
      description,
      postStartAction: "kickoff",
      disabled: disabledReason !== null,
    };
    if (disabledReason) {
      option.disabledReason = disabledReason;
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

  if (params.hasActiveGitConflict && params.roleEnabledByTask.build) {
    options.push({
      ...createSpecialOption(
        "quick:build_rebase_conflict_resolution",
        "build",
        "build_rebase_conflict_resolution",
        "Ask Builder to resolve the active git conflict.",
      ),
      postStartAction: "send_message",
    });
  }

  if (
    canShowPullRequestQuickAction(task, params.gitProviderContext) &&
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
      role: "build",
      launchActionId: "build_pull_request_generation",
      label: LAUNCH_ACTION_LABELS.build_pull_request_generation,
      description: "Reuse or fork a Builder session to create or update a pull request.",
      postStartAction: "kickoff",
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

  return orderQuickActions(task, options, workflowActionOrder);
};

export const selectPrimaryAgentStudioQuickAction = (
  options: AgentStudioQuickActionOption[],
): AgentStudioQuickActionOption | null => {
  return options.find((option) => !option.disabled) ?? options[0] ?? null;
};
