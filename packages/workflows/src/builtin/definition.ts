import {
  ODT_BROWSER_TOOL_NAMES,
  type AgentToolName,
  type WorkflowActionDefinition,
  type WorkflowArtifactDefinition,
  type WorkflowArtifactVerdict,
  type WorkflowAutomationDefinition,
  type WorkflowCondition,
  type WorkflowDefinition,
  type WorkflowEventEffect,
  type WorkflowEventGuard,
  type WorkflowLaunchActionDefinition,
  type WorkflowRoleDefinition,
  type WorkflowSignalDefinition,
  type WorkflowStateDefinition,
} from "@openducktor/contracts";
import { deepFreeze } from "../deep-freeze";
import { createWorkflow } from "../evaluate";
import type { AgentKickoffTemplateId, AgentMessageTemplateId } from "./agent-prompts";
import {
  activeOrReview,
  buildAvailable,
  humanReview,
  nonClosed,
  planningAvailable,
  planningComplete,
  planPresent,
  qaApproved,
  qaAvailable,
  qaRejected,
  requiredPlanning,
  specComplete,
  specPresent,
} from "./definition-conditions";
import { recordBy } from "../record-by";
import {
  BUILTIN_ISSUE_TYPE_IDS,
  BUILTIN_ROLE_IDS,
  BUILTIN_STATE_IDS,
  type BuiltinActionId,
  type BuiltinAutomationId,
  type BuiltinLaunchActionId,
  type BuiltinNotificationKind,
  type BuiltinRoleId,
  type BuiltinSignalId,
  type BuiltinStateId,
} from "./ids";

type BuiltinOutcome = {
  when: WorkflowCondition;
  to: BuiltinStateId | null;
  signal?: BuiltinSignalId;
  sourceRole?: BuiltinRoleId;
};
type BuiltinEvent = {
  from: BuiltinStateId[];
  guards: WorkflowEventGuard[];
  outcomes: BuiltinOutcome[];
  effect?: WorkflowEventEffect;
};

export type BuiltinArtifactId = "spec" | "plan" | "qaReport";
export type BuiltinRole = WorkflowRoleDefinition & {
  id: BuiltinRoleId;
  tools: AgentToolName[];
  writes: BuiltinArtifactId[];
};
export type BuiltinLaunchAction = WorkflowLaunchActionDefinition & {
  id: BuiltinLaunchActionId;
  template:
    | { kind: "kickoff"; id: AgentKickoffTemplateId }
    | { kind: "message"; id: AgentMessageTemplateId };
};
export type BuiltinState = WorkflowStateDefinition & {
  id: BuiltinStateId;
  notification?: WorkflowStateDefinition["notification"] & {
    kind: BuiltinNotificationKind;
    role?: BuiltinRoleId;
  };
  studioRole?: BuiltinRoleId;
};
export type BuiltinSignal = Omit<WorkflowSignalDefinition, "id" | "automations"> & {
  id: BuiltinSignalId;
  automations: BuiltinAutomationId[];
};
export type BuiltinAutomation = WorkflowAutomationDefinition & {
  id: BuiltinAutomationId;
  launchActionId: BuiltinLaunchActionId;
};
type BuiltinAction = WorkflowActionDefinition & {
  id: BuiltinActionId;
  eventId?: BuiltinTaskEventId;
  launchActionIds?: BuiltinLaunchActionId[];
};

const nonClosedStates = BUILTIN_STATE_IDS.filter((status) => status !== "closed");
const reviewOrClosed: BuiltinStateId[] = [...humanReview.stateIn, "closed"];

const moveTo = (to: BuiltinStateId, signal?: Omit<BuiltinOutcome, "when" | "to">) => [
  { when: true, to, ...signal },
];

const builtinEvents = {
  "set-status:open": {
    from: ["open"],
    guards: [],
    outcomes: moveTo("open"),
    effect: "status.set",
  },
  "set-status:spec_ready": {
    from: ["open", "spec_ready"],
    guards: [],
    outcomes: moveTo("spec_ready"),
    effect: "status.set",
  },
  "set-status:ready_for_dev": {
    from: ["open", "spec_ready", "ready_for_dev"],
    guards: [specComplete],
    outcomes: moveTo("ready_for_dev"),
    effect: "status.set",
  },
  "set-status:in_progress": {
    from: nonClosedStates,
    guards: [planningComplete],
    outcomes: moveTo("in_progress"),
    effect: "status.set",
  },
  "set-status:blocked": {
    from: ["in_progress", "blocked", "ai_review", "human_review"],
    guards: [],
    outcomes: moveTo("blocked"),
    effect: "status.set",
  },
  "set-status:ai_review": {
    from: ["in_progress", "blocked", "ai_review"],
    guards: [],
    outcomes: moveTo("ai_review"),
    effect: "status.set",
  },
  "set-status:human_review": {
    from: ["in_progress", "blocked", "ai_review", "human_review"],
    guards: [],
    outcomes: moveTo("human_review"),
    effect: "status.set",
  },
  "set-spec": {
    from: nonClosedStates,
    guards: [],
    outcomes: [
      { when: { stateIn: ["open"] }, to: "spec_ready", signal: "taskProgressedToSpecReady" },
      { when: true, to: null },
    ],
  },
  "set-plan": {
    from: nonClosedStates,
    guards: [specComplete],
    outcomes: [
      {
        when: { stateIn: ["open", "spec_ready"] },
        to: "ready_for_dev",
        signal: "taskProgressedToReadyForDev",
      },
      { when: true, to: null },
    ],
  },
  "start-builder": {
    from: nonClosedStates,
    guards: [planningComplete],
    outcomes: [
      { when: { stateIn: ["open", "spec_ready", "ready_for_dev"] }, to: "in_progress" },
      { when: true, to: null },
    ],
    effect: "build.start",
  },
  "build-blocked": {
    from: activeOrReview.stateIn,
    guards: [],
    outcomes: moveTo("blocked"),
    effect: "build.blocked",
  },
  "build-resumed": {
    from: nonClosedStates,
    guards: [planningComplete],
    outcomes: moveTo("in_progress"),
    effect: "build.resumed",
  },
  "build-completed": {
    from: activeOrReview.stateIn,
    guards: [],
    outcomes: [
      { when: humanReview, to: null },
      {
        when: qaApproved,
        to: "human_review",
        signal: "taskProgressedToHumanReview",
        sourceRole: "build",
      },
      { when: true, to: "ai_review", signal: "taskProgressedToAiReview" },
    ],
    effect: "build.completed",
  },
  "qa-approved": {
    from: qaAvailable.stateIn,
    guards: [],
    outcomes: moveTo("human_review", {
      signal: "taskProgressedToHumanReview",
      sourceRole: "qa",
    }),
  },
  "qa-rejected": {
    from: qaAvailable.stateIn,
    guards: [],
    outcomes: moveTo("in_progress", { signal: "taskRejectedByQa" }),
  },
  "human-request-changes": {
    from: ["in_progress", ...humanReview.stateIn],
    guards: [],
    outcomes: moveTo("in_progress"),
    effect: "review.request_changes",
  },
  "human-approve": {
    from: reviewOrClosed,
    guards: [],
    outcomes: moveTo("closed"),
    effect: "review.approve",
  },
  "direct-merge-local": {
    from: humanReview.stateIn,
    guards: [],
    outcomes: moveTo("closed"),
    effect: "direct_merge.local",
  },
  "direct-merge-publish": {
    from: humanReview.stateIn,
    guards: [],
    outcomes: moveTo("human_review"),
    effect: "direct_merge.publish",
  },
  "complete-direct-merge": {
    from: reviewOrClosed,
    guards: [],
    outcomes: moveTo("closed"),
    effect: "direct_merge.completed",
  },
  "close-merged-pull-request": {
    from: reviewOrClosed,
    guards: [],
    outcomes: moveTo("closed"),
    effect: "pull_request.merged",
  },
  "close-task": {
    from: [...nonClosedStates, "closed"],
    guards: [],
    outcomes: moveTo("closed"),
    effect: "task.close",
  },
  "reset-task": {
    from: nonClosedStates,
    guards: [],
    outcomes: moveTo("open"),
    effect: "task.reset",
  },
  "reset-implementation": {
    from: activeOrReview.stateIn,
    guards: [],
    outcomes: [
      { when: planPresent, to: "ready_for_dev" },
      { when: specPresent, to: "spec_ready" },
      { when: true, to: "open" },
    ],
    effect: "implementation.reset",
  },
  "manage-pull-request": {
    from: ["in_progress", ...humanReview.stateIn],
    guards: [],
    outcomes: [{ when: true, to: null }],
    effect: "pull_request.manage",
  },
} satisfies Record<string, BuiltinEvent>;

export type BuiltinTaskEventId = keyof typeof builtinEvents;

const builtinArtifacts = [
  {
    id: "spec",
    label: "Specification",
    shortLabel: "Spec",
    kind: "document",
    saveEventId: "set-spec",
  },
  {
    id: "plan",
    label: "Implementation Plan",
    shortLabel: "Plan",
    kind: "document",
    saveEventId: "set-plan",
  },
  {
    id: "qaReport",
    label: "QA Report",
    shortLabel: "QA",
    kind: "review",
    verdicts: [
      { id: "approved", label: "Approved", passes: true, eventId: "qa-approved" },
      { id: "rejected", label: "Rejected", passes: false, eventId: "qa-rejected" },
    ],
  },
] satisfies (WorkflowArtifactDefinition & {
  id: BuiltinArtifactId;
  saveEventId?: BuiltinTaskEventId;
  verdicts?: (WorkflowArtifactVerdict & { eventId: BuiltinTaskEventId })[];
})[];

const taskTools = [
  "odt_read_task",
  "odt_read_task_assets",
  "odt_read_task_artifacts",
  "odt_set_task_artifact",
  "odt_delete_task_artifact",
  "odt_search_tasks",
  "odt_create_task",
  "odt_update_task",
] as const satisfies readonly AgentToolName[];

const builtinRoles = [
  {
    id: "spec",
    label: "Spec",
    tools: [...taskTools, ...ODT_BROWSER_TOOL_NAMES],
    writes: ["spec"],
    workspaceAccess: "read",
    location: "repository",
    runtimeScopes: ["workspace"],
  },
  {
    id: "planner",
    label: "Planner",
    tools: [...taskTools, ...ODT_BROWSER_TOOL_NAMES],
    writes: ["plan"],
    workspaceAccess: "read",
    location: "repository",
    runtimeScopes: ["workspace"],
  },
  {
    id: "build",
    label: "Builder",
    tools: [
      ...taskTools,
      "odt_build_blocked",
      "odt_build_resumed",
      "odt_build_completed",
      "odt_set_pull_request",
      ...ODT_BROWSER_TOOL_NAMES,
    ],
    // Builder may revise the spec and plan.
    writes: ["spec", "plan"],
    workspaceAccess: "write",
    location: "task_worktree",
    runtimeScopes: ["build", "workspace"],
  },
  {
    id: "qa",
    label: "QA",
    tools: [...taskTools, ...ODT_BROWSER_TOOL_NAMES],
    writes: ["qaReport"],
    workspaceAccess: "read",
    location: "task_worktree",
    runtimeScopes: ["task"],
  },
] satisfies BuiltinRole[];

type BuiltinStateNotification = NonNullable<BuiltinState["notification"]>;

/** A notification is on, shows in the app and the OS, and plays the global cue by default. */
const notification = (
  status: Exclude<BuiltinStateId, "open">,
  {
    defaultSetting,
    ...copy
  }: Omit<BuiltinStateNotification, "kind" | "defaultSetting"> & {
    defaultSetting?: Partial<BuiltinStateNotification["defaultSetting"]>;
  },
): BuiltinStateNotification => ({
  kind: `workflow.${status}`,
  defaultSetting: { enabled: true, target: "both", sound: "inherit", ...defaultSetting },
  ...copy,
});

const builtinStates = [
  { id: "open", label: "Backlog", title: "Backlog" },
  {
    id: "spec_ready",
    label: "Spec ready",
    title: "Spec Ready",
    notification: notification("spec_ready", {
      label: "Spec Ready",
      description: "A Task moves to Spec Ready.",
      title: "Spec ready",
      body: "Task is ready for planning.",
      status: "Task moved to Spec Ready.",
      route: "agent_studio",
      role: "spec",
    }),
    studioRole: "spec",
  },
  {
    id: "ready_for_dev",
    label: "Ready for dev",
    title: "Ready for Dev",
    notification: notification("ready_for_dev", {
      label: "Ready for Dev",
      description: "A Task moves to Ready for Dev.",
      title: "Ready for dev",
      body: "The plan is ready. Start Builder to implement it.",
      status: "Task moved to Ready for Dev.",
      route: "agent_studio",
      role: "planner",
    }),
    studioRole: "planner",
  },
  {
    id: "in_progress",
    label: "In progress",
    title: "In Progress",
    notification: notification("in_progress", {
      label: "In Progress",
      description: "A Task moves to In Progress.",
      title: "In progress",
      body: "Work has started on this task.",
      status: "Task moved to In Progress.",
      route: "agent_studio",
      role: "build",
    }),
    studioRole: "build",
  },
  {
    id: "blocked",
    label: "Blocked needs input",
    title: "Blocked / Needs Input",
    shortLabel: "Blocked",
    notification: notification("blocked", {
      label: "Task Blocked",
      description: "A Task moves to Blocked.",
      title: "Blocked",
      body: "This task needs your input before work can continue.",
      status: "Task moved to Task Blocked.",
      route: "agent_studio",
      role: "build",
      defaultSetting: { sound: "bloom" },
    }),
    studioRole: "build",
  },
  {
    id: "ai_review",
    label: "AI review",
    title: "AI Review",
    notification: notification("ai_review", {
      label: "AI Review",
      description: "A Task moves to AI Review.",
      title: "Ready for QA",
      body: "The implementation is ready for QA review.",
      status: "Task moved to AI Review.",
      route: "agent_studio",
      role: "build",
    }),
    studioRole: "build",
  },
  {
    id: "human_review",
    label: "Human review",
    title: "Human Review",
    notification: notification("human_review", {
      label: "Human Review",
      description: "A Task moves to Human Review.",
      title: "Review",
      body: "Review the changes and approve or request updates.",
      status: "Task moved to Human Review.",
      route: "agent_studio",
      role: "qa",
    }),
    studioRole: "build",
  },
  {
    id: "closed",
    label: "Done",
    title: "Done",
    terminal: true,
    notification: notification("closed", {
      label: "Task Closed",
      description: "A Task moves to Closed.",
      title: "Closed",
      body: "This task is closed.",
      status: "Task moved to Closed.",
      route: "kanban",
      defaultSetting: { target: "in_app" },
    }),
    studioRole: "build",
  },
] satisfies BuiltinState[];

const fresh = (): Pick<BuiltinLaunchAction, "startModes" | "defaultStartMode"> => ({
  startModes: ["fresh"],
  defaultStartMode: "fresh",
});
const freshOrReuse = (): Pick<BuiltinLaunchAction, "startModes" | "defaultStartMode"> => ({
  startModes: ["fresh", "reuse"],
  defaultStartMode: "reuse",
});

const builtinSteps = [
  {
    id: "specification",
    label: "Spec",
    kind: "agent",
    roleId: "spec",
    inputs: [],
    outputs: ["spec"],
    requiredWhen: requiredPlanning,
    availableWhen: nonClosed,
    completedWhen: specPresent,
    launchActions: [
      {
        id: "spec_initial",
        label: "Spec",
        ...fresh(),
        template: { kind: "kickoff", id: "kickoff.spec_initial" },
      },
    ],
  },
  {
    id: "planning",
    label: "Planner",
    kind: "agent",
    roleId: "planner",
    inputs: ["spec"],
    outputs: ["plan"],
    requiredWhen: requiredPlanning,
    availableWhen: planningAvailable,
    completedWhen: planPresent,
    launchActions: [
      {
        id: "planner_initial",
        label: "Planner",
        ...fresh(),
        template: { kind: "kickoff", id: "kickoff.planner_initial" },
      },
    ],
  },
  {
    id: "implementation",
    label: "Builder",
    kind: "agent",
    roleId: "build",
    startEventId: "start-builder",
    inputs: ["spec", "plan"],
    outputs: [],
    requiredWhen: true,
    availableWhen: buildAvailable,
    completedWhen: { stateIn: ["ai_review", "human_review", "closed"] },
    launchActions: [
      {
        id: "build_implementation_start",
        label: "Start Implementation",
        ...fresh(),
        template: { kind: "kickoff", id: "kickoff.build_implementation_start" },
        targetBranch: true,
      },
      {
        id: "build_after_qa_rejected",
        label: "Fix QA Rejection",
        ...freshOrReuse(),
        template: { kind: "kickoff", id: "kickoff.build_after_qa_rejected" },
        selectWhen: qaRejected,
        requiresWorktree: true,
      },
      {
        id: "build_after_human_request_changes",
        label: "Apply Human Changes",
        ...freshOrReuse(),
        template: { kind: "kickoff", id: "kickoff.build_after_human_request_changes" },
        selectWhen: { stateIn: ["human_review"] },
        context: "human_feedback",
        requiresWorktree: true,
      },
      {
        id: "build_pull_request_generation",
        label: "Generate Pull Request",
        startModes: ["reuse", "fork"],
        defaultStartMode: "reuse",
        template: { kind: "kickoff", id: "kickoff.build_pull_request_generation" },
        context: "pull_request",
        targetBranch: true,
        requiresWorktree: true,
      },
      {
        id: "build_rebase_conflict_resolution",
        label: "Resolve Git Conflict",
        ...freshOrReuse(),
        template: { kind: "message", id: "message.build_rebase_conflict_resolution" },
        requiresWorktree: true,
      },
    ],
  },
  {
    id: "quality-review",
    label: "QA",
    kind: "agent",
    roleId: "qa",
    inputs: ["spec", "plan"],
    outputs: ["qaReport"],
    requiredWhen: true,
    availableWhen: qaAvailable,
    completedWhen: qaApproved,
    launchActions: [
      {
        id: "qa_review",
        label: "QA Review",
        ...freshOrReuse(),
        template: { kind: "kickoff", id: "kickoff.qa_review" },
      },
    ],
  },
] satisfies (WorkflowDefinition["steps"][number] & {
  kind: "agent";
  roleId: BuiltinRoleId;
  launchActions: BuiltinLaunchAction[];
  startEventId?: BuiltinTaskEventId;
})[];

/** Action labels are the default UI labels. Presentation adds only surface-specific variants. */
const builtinActions = [
  { id: "view_details", kind: "view", label: "View details", availableWhen: true },
  {
    id: "set_spec",
    kind: "session",
    label: "Start Spec",
    stepId: "specification",
    eventId: "set-spec",
    launchActionIds: ["spec_initial"],
    // A ready spec continues in its session through open_spec.
    availableWhen: { not: { stateIn: ["spec_ready"] } },
  },
  {
    id: "set_plan",
    kind: "session",
    label: "Start Planner",
    stepId: "planning",
    eventId: "set-plan",
    launchActionIds: ["planner_initial"],
    availableWhen: true,
  },
  {
    id: "qa_start",
    kind: "session",
    label: "Request QA Review",
    stepId: "quality-review",
    launchActionIds: ["qa_review"],
    availableWhen: qaAvailable,
  },
  {
    id: "build_start",
    kind: "session",
    label: "Start Builder",
    labels: [{ when: qaRejected, label: "Address QA Feedbacks" }],
    stepId: "implementation",
    launchActionIds: ["build_implementation_start", "build_after_qa_rejected"],
    availableWhen: { any: [qaRejected, { all: [{ not: activeOrReview }, buildAvailable] }] },
  },
  {
    id: "open_spec",
    kind: "view",
    label: "Open Spec",
    stepId: "specification",
    availableWhen: { stateIn: ["spec_ready"] },
  },
  // A task card also shows a session view action when its role has a session.
  {
    id: "open_planner",
    kind: "view",
    label: "Open Planner",
    stepId: "planning",
    availableWhen: false,
  },
  {
    id: "open_builder",
    kind: "view",
    label: "Open Builder",
    stepId: "implementation",
    availableWhen: activeOrReview,
  },
  {
    id: "reset_implementation",
    kind: "event",
    label: "Reset Implementation",
    eventId: "reset-implementation",
    availableWhen: true,
  },
  {
    id: "reset_task",
    kind: "event",
    label: "Reset Task",
    eventId: "reset-task",
    availableWhen: true,
  },
  {
    id: "open_qa",
    kind: "view",
    label: "Open QA",
    stepId: "quality-review",
    availableWhen: qaRejected,
  },
  {
    id: "human_request_changes",
    kind: "event",
    label: "Request Changes",
    eventId: "human-request-changes",
    launchActionIds: ["build_after_human_request_changes"],
    availableWhen: humanReview,
  },
  {
    id: "human_approve",
    kind: "event",
    label: "Approve Task",
    eventId: "human-approve",
    availableWhen: humanReview,
  },
  {
    id: "close_task",
    kind: "event",
    label: "Close Task",
    eventId: "close-task",
    availableWhen: nonClosed,
  },
  {
    id: "remove_worktree",
    kind: "view",
    label: "Remove Worktree",
    availableWhen: { stateIn: ["closed"] },
  },
] satisfies BuiltinAction[];

const builtinSignals = [
  {
    id: "taskProgressedToSpecReady",
    label: "When a task progresses to Spec Ready",
    description:
      "Runs when a spec save moves a task from Backlog to Spec Ready. A reset implementation does not count.",
    automations: ["startPlanner"],
  },
  {
    id: "taskProgressedToReadyForDev",
    label: "When a task progresses to Ready for Dev",
    description:
      "Runs when a plan save moves a task from Backlog or Spec Ready to Ready for Dev. A reset implementation does not count.",
    automations: ["startBuilder"],
  },
  {
    id: "taskProgressedToAiReview",
    label: "When a task progresses to AI Review",
    description: "Runs when a build completion moves a task to AI Review.",
    automations: ["startQa"],
  },
  {
    id: "taskRejectedByQa",
    label: "When a task is rejected by QA",
    description:
      "Runs for each QA rejection that moves a task back to In Progress. A human change request does not count.",
    automations: ["startReviewQaFeedbacks"],
  },
  {
    id: "taskProgressedToHumanReview",
    label: "When a task progresses to Human Review",
    description:
      "Runs when a build completion or a QA approval moves a task to Human Review. A direct merge does not count.",
    automations: ["startGeneratePullRequest"],
  },
] satisfies BuiltinSignal[];

const builtinAutomations = [
  {
    id: "startPlanner",
    label: "Start Planner",
    description:
      "Start the Planner workflow when a task becomes ready for implementation planning.",
    launchActionId: "planner_initial",
  },
  {
    id: "startBuilder",
    label: "Start Builder",
    description: "Start or continue Builder implementation when planning is complete.",
    launchActionId: "build_implementation_start",
  },
  {
    id: "startQa",
    label: "Start QA",
    description: "Start or continue QA review once implementation reaches AI review.",
    launchActionId: "qa_review",
  },
  {
    id: "startReviewQaFeedbacks",
    label: "Start Review QA Feedbacks",
    description: "Resume Builder to address rejected QA findings at the root cause.",
    launchActionId: "build_after_qa_rejected",
  },
  {
    id: "startGeneratePullRequest",
    label: "Start Generate Pull Request",
    description: "Fork from the latest Builder session to generate or update the pull request.",
    launchActionId: "build_pull_request_generation",
    startMode: "fork",
  },
] satisfies BuiltinAutomation[];

const secondaryActions: BuiltinActionId[] = [
  "open_spec",
  "open_planner",
  "open_builder",
  "open_qa",
  "human_approve",
  "human_request_changes",
  "reset_implementation",
  "reset_task",
  "close_task",
  "remove_worktree",
];

/** The source of the built-in definition. */
export const BUILTIN_DEFINITION = {
  schemaVersion: 1,
  id: "openducktor",
  revision: 2,
  label: "OpenDucktor",
  initialState: "open",
  facts: [{ id: "issueType", type: "enum", values: [...BUILTIN_ISSUE_TYPE_IDS] }],
  roles: builtinRoles,
  artifacts: builtinArtifacts,
  states: builtinStates,
  steps: builtinSteps,
  actions: builtinActions,
  events: Object.entries(builtinEvents).map(([id, event]) => ({ id, ...event })),
  signals: builtinSignals,
  automations: builtinAutomations,
  actionOrder: [
    {
      when: requiredPlanning,
      actions: ["set_spec", "set_plan", "build_start", "qa_start", ...secondaryActions],
    },
    {
      when: true,
      actions: ["build_start", "qa_start", "set_plan", "set_spec", ...secondaryActions],
    },
  ],
  actionPriority: [
    { when: { stateIn: ["spec_ready"] }, actions: ["set_plan", "set_spec"] },
    { when: { stateIn: ["ready_for_dev"] }, actions: ["build_start"] },
    { when: qaRejected, actions: ["build_start", "open_builder", "open_qa"] },
    { when: { stateIn: ["in_progress", "blocked"] }, actions: ["open_builder", "build_start"] },
    {
      when: { stateIn: ["ai_review"] },
      actions: ["qa_start", "human_approve", "human_request_changes", "open_builder"],
    },
    {
      when: { stateIn: ["human_review"] },
      actions: [
        "human_approve",
        "human_request_changes",
        "qa_start",
        "open_builder",
        "build_start",
      ],
    },
  ],
} satisfies WorkflowDefinition;

export const builtinWorkflow = createWorkflow(BUILTIN_DEFINITION);

/** The built-in states are the task statuses, in their contract order. */
export const BUILTIN_STATES: readonly BuiltinState[] = deepFreeze(builtinStates);
export const BUILTIN_ROLES: readonly BuiltinRole[] = deepFreeze(builtinRoles);
export const BUILTIN_ARTIFACTS: readonly (typeof builtinArtifacts)[number][] =
  deepFreeze(builtinArtifacts);
export const BUILTIN_STEPS: readonly (typeof builtinSteps)[number][] = deepFreeze(builtinSteps);
export const BUILTIN_LAUNCH_ACTIONS: readonly BuiltinLaunchAction[] = BUILTIN_STEPS.flatMap(
  (step): readonly BuiltinLaunchAction[] => step.launchActions,
);
export const BUILTIN_ACTIONS: readonly (typeof builtinActions)[number][] =
  deepFreeze(builtinActions);
export const BUILTIN_EVENTS: Readonly<Record<BuiltinTaskEventId, BuiltinEvent>> =
  deepFreeze(builtinEvents);
export const BUILTIN_SIGNALS: readonly BuiltinSignal[] = deepFreeze(builtinSignals);
export const BUILTIN_AUTOMATIONS: readonly BuiltinAutomation[] = deepFreeze(builtinAutomations);

const stateById = new Map(BUILTIN_STATES.map((state) => [state.id, state]));
const builtinState = (status: BuiltinStateId): BuiltinState => {
  const state = stateById.get(status);
  if (!state) throw new Error(`The built-in workflow has no state ${status}.`);
  return state;
};
const byStatus = <Value>(
  read: (state: BuiltinState) => Value,
): Readonly<Record<BuiltinStateId, Value>> =>
  deepFreeze(recordBy(BUILTIN_STATE_IDS, (status) => read(builtinState(status))));
export const BUILTIN_STATUS_LABELS = byStatus((state) => state.label);
export const BUILTIN_STATUS_TITLES = byStatus((state) => state.title ?? state.label);
export const BUILTIN_STATUS_SHORT_LABELS = byStatus((state) => state.shortLabel ?? state.label);
export const BUILTIN_TERMINAL_STATUSES: readonly BuiltinStateId[] = BUILTIN_STATES.filter(
  (state) => state.terminal,
).map((state) => state.id);

const roleById = new Map(BUILTIN_ROLES.map((role) => [role.id, role]));
export const builtinRole = (id: BuiltinRoleId): BuiltinRole => {
  const role = roleById.get(id);
  if (!role) throw new Error(`The built-in workflow has no role ${id}.`);
  return role;
};
/** Builds a value for each built-in role. */
export const byRole = <Value>(
  read: (role: BuiltinRole) => Value,
): Readonly<Record<BuiltinRoleId, Value>> =>
  deepFreeze(recordBy(BUILTIN_ROLE_IDS, (id) => read(builtinRole(id))));
export const BUILTIN_ROLE_LABELS = byRole((role) => role.label);

type BuiltinArtifact = (typeof builtinArtifacts)[number];
/** The workflow documents. People edit them. Reviews change only with their verdicts. */
export type BuiltinDocumentCode = Extract<BuiltinArtifact, { kind: "document" }>["id"];
const isDocument = (
  artifact: BuiltinArtifact,
): artifact is Extract<BuiltinArtifact, { kind: "document" }> => artifact.kind === "document";
export const BUILTIN_DOCUMENT_CODES: readonly BuiltinDocumentCode[] = builtinArtifacts
  .filter(isDocument)
  .map((artifact) => artifact.id);
/** Builds a value for each workflow document. */
export const byDocumentCode = <Value>(read: (code: BuiltinDocumentCode) => Value) =>
  recordBy(BUILTIN_DOCUMENT_CODES, read);
