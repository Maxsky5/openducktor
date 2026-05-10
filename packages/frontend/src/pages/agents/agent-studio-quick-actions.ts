import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentSessionStartMode } from "@openducktor/core";
import {
  AGENT_STUDIO_SESSION_START_ACTIONS,
  resolveTaskCardActions,
  type TaskWorkflowAction,
} from "@/components/features/kanban/kanban-task-workflow";
import { taskActionLabel } from "@/components/features/kanban/task-action-ui";
import {
  buildReusableSessionOptions,
  getSessionLaunchAction,
  LAUNCH_ACTION_LABELS,
  type SessionLaunchActionId,
  type SessionStartExistingSessionOption,
  type SessionStartPostAction,
} from "@/features/session-start";
import { isQaRejectedTask } from "@/lib/task-qa";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";

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
  initialSourceExternalSessionId?: string | null;
  requiresHumanFeedback?: boolean;
};

const createQuickActionDisabledReason = (createSessionDisabled: boolean): string | null => {
  return createSessionDisabled ? "Wait for the current session to finish." : null;
};

const PULL_REQUEST_QUICK_ACTION_STATUSES = new Set<TaskCard["status"]>(["human_review"]);

const canShowPullRequestQuickAction = (task: TaskCard): boolean => {
  return PULL_REQUEST_QUICK_ACTION_STATUSES.has(task.status);
};

const hasLinkedPullRequest = (task: TaskCard): boolean => {
  return task.pullRequest !== undefined;
};

const quickActionIdForWorkflowAction = (
  action: TaskWorkflowAction,
  task: TaskCard,
): SessionLaunchActionId => {
  if (action === "set_spec") {
    return "spec_initial";
  }
  if (action === "set_plan") {
    return "planner_initial";
  }
  if (action === "build_start") {
    return isQaRejectedTask(task) ? "build_after_qa_rejected" : "build_implementation_start";
  }
  if (action === "qa_start") {
    return "qa_review";
  }
  if (action === "human_request_changes") {
    return "build_after_human_request_changes";
  }
  throw new Error(`Unsupported Agent Studio quick action workflow action: ${action}`);
};

const quickActionRoleForWorkflowAction = (action: TaskWorkflowAction): AgentRole => {
  if (action === "set_spec") {
    return "spec";
  }
  if (action === "set_plan") {
    return "planner";
  }
  if (action === "qa_start") {
    return "qa";
  }
  return "build";
};

const quickActionDescriptionForWorkflowAction = (action: TaskWorkflowAction): string => {
  if (action === "set_spec") {
    return "Open the start-session flow for the Spec workflow.";
  }
  if (action === "set_plan") {
    return "Open the start-session flow for the Planner workflow.";
  }
  if (action === "qa_start") {
    return "Open the start-session flow for QA review.";
  }
  if (action === "human_request_changes") {
    return "Collect human feedback, then open the Builder rework flow.";
  }
  return "Open the start-session flow for Builder implementation work.";
};

const orderQuickActions = (
  task: TaskCard,
  options: AgentStudioQuickActionOption[],
  workflowActionOrder: readonly TaskWorkflowAction[],
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
}): AgentStudioQuickActionOption[] => {
  const task = params.selectedTask;
  if (!task) {
    return [];
  }

  const workflowActionOrder = resolveTaskCardActions(task, {
    include: AGENT_STUDIO_SESSION_START_ACTIONS,
    surface: "agent_studio_quick_actions",
  }).allActions;
  const disabledReason = createQuickActionDisabledReason(params.createSessionDisabled);
  const createLifecycleOption = (
    action: TaskWorkflowAction,
  ): AgentStudioQuickActionOption | null => {
    const launchActionId = quickActionIdForWorkflowAction(action, task);
    const role = quickActionRoleForWorkflowAction(action);
    if (!params.roleEnabledByTask[role]) {
      return null;
    }
    return {
      id: `quick:${launchActionId}`,
      role,
      launchActionId,
      label: taskActionLabel(action, task, { surface: "agent_studio" }),
      description: quickActionDescriptionForWorkflowAction(action),
      postStartAction: "kickoff",
      disabled: disabledReason !== null,
      ...(disabledReason ? { disabledReason } : {}),
      ...(action === "human_request_changes" ? { requiresHumanFeedback: true } : {}),
    };
  };
  const createSpecialOption = (
    id: string,
    role: AgentRole,
    launchActionId: SessionLaunchActionId,
    description: string,
  ): AgentStudioQuickActionOption => ({
    id,
    role,
    launchActionId,
    label: LAUNCH_ACTION_LABELS[launchActionId],
    description,
    postStartAction: "kickoff",
    disabled: disabledReason !== null,
    ...(disabledReason ? { disabledReason } : {}),
  });

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

  if (canShowPullRequestQuickAction(task) && params.roleEnabledByTask.build) {
    const builderSessionOptions = buildReusableSessionOptions({
      sessions: params.sessionsForTask.filter((session) => session.taskId === task.id),
      role: "build",
    });
    const hasBuilderSource = builderSessionOptions.length > 0;
    const pullRequestDisabledReason =
      disabledReason ?? (hasBuilderSource ? null : "Requires an existing Builder session.");
    options.push({
      id: "quick:build_pull_request_generation",
      role: "build",
      launchActionId: "build_pull_request_generation",
      label: LAUNCH_ACTION_LABELS.build_pull_request_generation,
      description: "Reuse or fork a Builder session to create or update a pull request.",
      postStartAction: "kickoff",
      disabled: pullRequestDisabledReason !== null,
      ...(pullRequestDisabledReason ? { disabledReason: pullRequestDisabledReason } : {}),
      ...(hasBuilderSource
        ? {
            initialStartMode: getSessionLaunchAction("build_pull_request_generation")
              .defaultStartMode,
            existingSessionOptions: builderSessionOptions,
            initialSourceExternalSessionId: builderSessionOptions[0]?.value ?? null,
          }
        : {}),
    });
  }

  return orderQuickActions(task, options, workflowActionOrder);
};

export const selectPrimaryAgentStudioQuickAction = (
  options: AgentStudioQuickActionOption[],
): AgentStudioQuickActionOption | null => {
  return options.find((option) => !option.disabled) ?? options[0] ?? null;
};
