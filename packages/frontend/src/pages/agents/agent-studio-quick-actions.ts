import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentSessionStartMode } from "@openducktor/core";
import {
  resolveTaskCardActions,
  type TaskWorkflowAction,
} from "@/components/features/kanban/kanban-task-workflow";
import {
  buildReusableSessionOptions,
  getSessionLaunchAction,
  LAUNCH_ACTION_LABELS,
  resolveBuildContinuationLaunchAction,
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

const QUICK_ACTION_WORKFLOW_ACTIONS: readonly TaskWorkflowAction[] = [
  "set_spec",
  "set_plan",
  "build_start",
  "qa_start",
  "human_request_changes",
];

const PULL_REQUEST_QUICK_ACTION_STATUSES = new Set<TaskCard["status"]>([
  "ai_review",
  "human_review",
]);

const canShowPullRequestQuickAction = (task: TaskCard): boolean => {
  return PULL_REQUEST_QUICK_ACTION_STATUSES.has(task.status);
};

const canStartRoleWorkflow = (params: {
  task: TaskCard;
  role: AgentRole;
  roleEnabledByTask: Record<AgentRole, boolean>;
}): boolean => {
  if (params.role === "build") {
    return params.roleEnabledByTask.build && !params.task.agentWorkflows.builder.completed;
  }

  if (params.role === "qa") {
    const qaWorkflow = params.task.agentWorkflows.qa;
    return (
      !qaWorkflow.completed && (params.roleEnabledByTask.qa || params.task.status === "ai_review")
    );
  }

  const workflow = params.task.agentWorkflows[params.role];
  return params.roleEnabledByTask[params.role] && !workflow.completed;
};

const canOfferBuildQuickAction = (params: {
  task: TaskCard;
  availableWorkflowActions: Set<TaskWorkflowAction>;
  roleEnabledByTask: Record<AgentRole, boolean>;
}): boolean => {
  if (
    !canStartRoleWorkflow({
      task: params.task,
      role: "build",
      roleEnabledByTask: params.roleEnabledByTask,
    })
  ) {
    return false;
  }

  return params.availableWorkflowActions.has("build_start") || params.task.status === "in_progress";
};

const canOfferQaQuickAction = (params: {
  task: TaskCard;
  availableWorkflowActions: Set<TaskWorkflowAction>;
  roleEnabledByTask: Record<AgentRole, boolean>;
}): boolean => {
  if (
    !canStartRoleWorkflow({
      task: params.task,
      role: "qa",
      roleEnabledByTask: params.roleEnabledByTask,
    })
  ) {
    return false;
  }

  return params.availableWorkflowActions.has("qa_start") || params.task.status === "ai_review";
};

const quickActionLabelForWorkflowAction = (action: TaskWorkflowAction, task: TaskCard): string => {
  if (action === "set_spec") {
    return task.status === "spec_ready" ? "Open Spec" : "Start Spec";
  }
  if (action === "set_plan") {
    return "Start Planner";
  }
  if (action === "build_start") {
    if (isQaRejectedTask(task)) {
      return "Address QA Feedbacks";
    }
    return task.status === "human_review" ? "Apply Human Changes" : "Start Implementation";
  }
  if (action === "qa_start") {
    return "Request QA Review";
  }
  return "Request Changes";
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
    return resolveBuildContinuationLaunchAction(task);
  }
  if (action === "qa_start") {
    return "qa_review";
  }
  if (action === "human_request_changes") {
    return "build_after_human_request_changes";
  }
  throw new Error(`Unsupported Agent Studio quick action workflow action: ${action}`);
};

const orderQuickActions = (
  task: TaskCard,
  options: AgentStudioQuickActionOption[],
): AgentStudioQuickActionOption[] => {
  const orderedWorkflowActions = resolveTaskCardActions(task, {
    include: QUICK_ACTION_WORKFLOW_ACTIONS,
  }).allActions;
  const orderedWorkflowLaunchActions = orderedWorkflowActions.map((action) =>
    quickActionIdForWorkflowAction(action, task),
  );

  const launchActionPriority = new Map(
    orderedWorkflowLaunchActions.map((launchActionId, index) => [launchActionId, index]),
  );
  if (task.status === "human_review") {
    launchActionPriority.set("build_pull_request_generation", -1);
  }
  if (task.status === "ai_review" && !task.agentWorkflows.qa.completed) {
    launchActionPriority.set("qa_review", -1);
  }
  if (isQaRejectedTask(task)) {
    launchActionPriority.set("build_after_qa_rejected", -1);
  } else if (task.status === "in_progress" && !task.agentWorkflows.builder.completed) {
    launchActionPriority.set("build_implementation_start", -1);
  }
  const fallbackPriority = launchActionPriority.size + 1;

  return [...options].sort((left, right) => {
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

  const availableWorkflowActions = new Set(
    resolveTaskCardActions(task, { include: QUICK_ACTION_WORKFLOW_ACTIONS }).allActions,
  );
  const disabledReason = createQuickActionDisabledReason(params.createSessionDisabled);
  const createLifecycleOption = (
    id: string,
    role: AgentRole,
    launchActionId: SessionLaunchActionId,
    description: string,
    label = LAUNCH_ACTION_LABELS[launchActionId],
  ): AgentStudioQuickActionOption => ({
    id,
    role,
    launchActionId,
    label,
    description,
    postStartAction: "kickoff",
    disabled: disabledReason !== null,
    ...(disabledReason ? { disabledReason } : {}),
  });

  const options: AgentStudioQuickActionOption[] = [];

  if (params.hasActiveGitConflict && params.roleEnabledByTask.build) {
    options.push({
      ...createLifecycleOption(
        "quick:build_rebase_conflict_resolution",
        "build",
        "build_rebase_conflict_resolution",
        "Ask Builder to resolve the active git conflict.",
      ),
      postStartAction: "send_message",
    });
  }

  if (
    availableWorkflowActions.has("set_spec") &&
    canStartRoleWorkflow({ task, role: "spec", roleEnabledByTask: params.roleEnabledByTask })
  ) {
    options.push(
      createLifecycleOption(
        "quick:spec_initial",
        "spec",
        "spec_initial",
        "Open the start-session flow for the Spec workflow.",
        quickActionLabelForWorkflowAction("set_spec", task),
      ),
    );
  }

  if (
    availableWorkflowActions.has("set_plan") &&
    canStartRoleWorkflow({ task, role: "planner", roleEnabledByTask: params.roleEnabledByTask })
  ) {
    options.push(
      createLifecycleOption(
        "quick:planner_initial",
        "planner",
        "planner_initial",
        "Open the start-session flow for the Planner workflow.",
        quickActionLabelForWorkflowAction("set_plan", task),
      ),
    );
  }

  if (
    canOfferBuildQuickAction({
      task,
      availableWorkflowActions,
      roleEnabledByTask: params.roleEnabledByTask,
    })
  ) {
    const launchActionId = resolveBuildContinuationLaunchAction(task);
    options.push(
      createLifecycleOption(
        `quick:${launchActionId}`,
        "build",
        launchActionId,
        "Open the start-session flow for Builder implementation work.",
        quickActionLabelForWorkflowAction("build_start", task),
      ),
    );
  }

  if (
    canOfferQaQuickAction({
      task,
      availableWorkflowActions,
      roleEnabledByTask: params.roleEnabledByTask,
    })
  ) {
    options.push(
      createLifecycleOption(
        "quick:qa_review",
        "qa",
        "qa_review",
        "Open the start-session flow for QA review.",
        quickActionLabelForWorkflowAction("qa_start", task),
      ),
    );
  }

  if (availableWorkflowActions.has("human_request_changes") && params.roleEnabledByTask.build) {
    options.push({
      ...createLifecycleOption(
        "quick:build_after_human_request_changes",
        "build",
        "build_after_human_request_changes",
        "Collect human feedback, then open the Builder rework flow.",
        quickActionLabelForWorkflowAction("human_request_changes", task),
      ),
      requiresHumanFeedback: true,
    });
  }

  if (canShowPullRequestQuickAction(task)) {
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

  return orderQuickActions(task, options);
};

export const selectPrimaryAgentStudioQuickAction = (
  options: AgentStudioQuickActionOption[],
): AgentStudioQuickActionOption | null => {
  return options[0] ?? null;
};
