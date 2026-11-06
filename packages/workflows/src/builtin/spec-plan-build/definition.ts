import {
  type WorkflowActionDefinition,
  type WorkflowArtifactDefinition,
  type WorkflowArtifactVerdict,
  type WorkflowAgentEvent,
  type WorkflowAutomationDefinition,
  type WorkflowCondition,
  type WorkflowDefinition,
  type HostEffectId,
  type WorkflowEventGuard,
  type WorkflowIssueTypeDefinition,
  type WorkflowLaunchActionDefinition,
  type WorkflowRoleDefinition,
  type WorkflowSignalDefinition,
  type WorkflowStateDefinition,
} from "@openducktor/contracts";
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
import {
  SPEC_PLAN_BUILD_STATE_IDS,
  type SpecPlanBuildActionId,
  type SpecPlanBuildAutomationId,
  type SpecPlanBuildLaunchActionId,
  type SpecPlanBuildNotificationKind,
  type SpecPlanBuildSignalId,
  type SpecPlanBuildStateId,
} from "./ids";
import type { BuiltinRoleId } from "../roles/ids";

type SpecPlanBuildOutcome = {
  when: WorkflowCondition;
  to: SpecPlanBuildStateId | null;
  signal?: SpecPlanBuildSignalId;
  sourceRole?: BuiltinRoleId;
};
type SpecPlanBuildEvent = {
  from: SpecPlanBuildStateId[];
  guards: WorkflowEventGuard[];
  outcomes: SpecPlanBuildOutcome[];
  effects?: HostEffectId[];
  agent?: WorkflowAgentEvent & { roles: BuiltinRoleId[] };
};

export type SpecPlanBuildArtifactId = "spec" | "plan" | "qaReport";
export type SpecPlanBuildRole = WorkflowRoleDefinition & {
  id: BuiltinRoleId;
  writes: SpecPlanBuildArtifactId[];
};
export type SpecPlanBuildLaunchAction = WorkflowLaunchActionDefinition & {
  id: SpecPlanBuildLaunchActionId;
  template:
    | { kind: "kickoff"; id: AgentKickoffTemplateId }
    | { kind: "message"; id: AgentMessageTemplateId };
};
export type SpecPlanBuildState = WorkflowStateDefinition & {
  id: SpecPlanBuildStateId;
  notification?: WorkflowStateDefinition["notification"] & {
    kind: SpecPlanBuildNotificationKind;
    role?: BuiltinRoleId;
  };
  studioRole?: BuiltinRoleId;
};
export type SpecPlanBuildSignal = Omit<WorkflowSignalDefinition, "id" | "automations"> & {
  id: SpecPlanBuildSignalId;
  automations: SpecPlanBuildAutomationId[];
};
export type SpecPlanBuildAutomation = WorkflowAutomationDefinition & {
  id: SpecPlanBuildAutomationId;
  launchActionId: SpecPlanBuildLaunchActionId;
};
type SpecPlanBuildAction = WorkflowActionDefinition & {
  id: SpecPlanBuildActionId;
  eventId?: SpecPlanBuildTaskEventId;
  launchActionIds?: SpecPlanBuildLaunchActionId[];
};

const nonClosedStates = SPEC_PLAN_BUILD_STATE_IDS.filter((status) => status !== "closed");

const moveTo = (to: SpecPlanBuildStateId, signal?: Omit<SpecPlanBuildOutcome, "when" | "to">) => [
  { when: true, to, ...signal },
];

const specPlanBuildEvents = {
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
  },
  "build-blocked": {
    from: activeOrReview.stateIn,
    guards: [],
    outcomes: moveTo("blocked"),
    agent: {
      roles: ["build"],
      note: "required",
      description: "Move the task to blocked. Put the reason in the note.",
    },
  },
  "build-resumed": {
    from: nonClosedStates,
    guards: [planningComplete],
    outcomes: moveTo("in_progress"),
    agent: {
      roles: ["build"],
      note: "optional",
      description: "Move a blocked task back to in_progress.",
    },
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
    agent: {
      roles: ["build"],
      note: "optional",
      description:
        "Move an in_progress task to ai_review, or to human_review when the latest QA report is approved.",
    },
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
  },
  "reset-implementation": {
    from: activeOrReview.stateIn,
    guards: [],
    outcomes: [
      { when: planPresent, to: "ready_for_dev" },
      { when: specPresent, to: "spec_ready" },
      { when: true, to: "open" },
    ],
    effects: ["worktree.reset"],
  },
} satisfies Record<string, SpecPlanBuildEvent>;

export type SpecPlanBuildTaskEventId = keyof typeof specPlanBuildEvents;

const specPlanBuildArtifacts = [
  {
    id: "spec",
    label: "Specification",
    shortLabel: "Spec",
    kind: "document",
    saveEventId: "set-spec",
    placeholder: "# Purpose\n\nDescribe expected outcome...",
  },
  {
    id: "plan",
    label: "Implementation Plan",
    shortLabel: "Plan",
    kind: "document",
    saveEventId: "set-plan",
    placeholder: "## Milestones\n\n- ...",
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
  id: SpecPlanBuildArtifactId;
  saveEventId?: SpecPlanBuildTaskEventId;
  verdicts?: (WorkflowArtifactVerdict & { eventId: SpecPlanBuildTaskEventId })[];
})[];

const specPlanBuildRoles = [
  { id: "spec", writes: ["spec"] },
  { id: "planner", writes: ["plan"] },
  // Builder may revise the spec and plan.
  { id: "build", writes: ["spec", "plan"] },
  { id: "qa", writes: ["qaReport"] },
] satisfies SpecPlanBuildRole[];

type SpecPlanBuildStateNotification = NonNullable<SpecPlanBuildState["notification"]>;

/** A notification is on, shows in the app and the OS, and plays the global cue by default. */
const notification = (
  status: Exclude<SpecPlanBuildStateId, "open">,
  {
    defaultSetting,
    ...copy
  }: Omit<SpecPlanBuildStateNotification, "kind" | "defaultSetting"> & {
    defaultSetting?: Partial<SpecPlanBuildStateNotification["defaultSetting"]>;
  },
): SpecPlanBuildStateNotification => ({
  kind: `workflow.${status}`,
  defaultSetting: { enabled: true, target: "both", sound: "inherit", ...defaultSetting },
  ...copy,
});

const specPlanBuildStates = [
  { id: "open", label: "Backlog", title: "Backlog", tone: "neutral" },
  {
    id: "spec_ready",
    label: "Spec ready",
    title: "Spec Ready",
    shortLabel: "Spec",
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
    tone: "pending",
    historyRoles: ["spec"],
  },
  {
    id: "ready_for_dev",
    label: "Ready for dev",
    title: "Ready for Dev",
    shortLabel: "Ready",
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
    tone: "info",
    historyRoles: ["planner", "spec"],
  },
  {
    id: "in_progress",
    label: "In progress",
    title: "In Progress",
    shortLabel: "Progress",
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
    tone: "warning",
    mergeDetection: true,
    historyRoles: ["build"],
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
    tone: "destructive",
    mergeDetection: true,
    historyRoles: ["build"],
    historyLatest: true,
  },
  {
    id: "ai_review",
    label: "AI review",
    title: "AI Review",
    shortLabel: "AI QA",
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
    tone: "review",
    mergeDetection: true,
    historyRoles: ["build"],
  },
  {
    id: "human_review",
    label: "Human review",
    title: "Human Review",
    shortLabel: "Review",
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
    tone: "approval",
    mergeDetection: true,
    historyRoles: ["build"],
  },
  {
    id: "closed",
    label: "Done",
    title: "Done",
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
    tone: "success",
    historyRoles: ["build"],
  },
] satisfies SpecPlanBuildState[];

const fresh = (): Pick<SpecPlanBuildLaunchAction, "startModes" | "defaultStartMode"> => ({
  startModes: ["fresh"],
  defaultStartMode: "fresh",
});
const freshOrReuse = (): Pick<SpecPlanBuildLaunchAction, "startModes" | "defaultStartMode"> => ({
  startModes: ["fresh", "reuse"],
  defaultStartMode: "reuse",
});

const implementationComplete = {
  stateIn: ["ai_review", "human_review", "closed"],
} satisfies WorkflowCondition;

const specPlanBuildSteps = [
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
        template: { kind: "kickoff", id: "messages.spec_start" },
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
        template: { kind: "kickoff", id: "messages.plan_start" },
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
    completedWhen: implementationComplete,
    displayRules: [
      { when: qaRejected, completion: "done" },
      {
        when: { stateIn: ["blocked"] },
        session: ["none", "idle", "stopped", "waiting_input"],
        attention: "needs_input",
      },
      // A stopped Builder session pauses the implementation; it does not reset it.
      {
        when: { all: [buildAvailable, { not: implementationComplete }] },
        session: ["stopped"],
        completion: "in_progress",
      },
    ],
    launchActions: [
      {
        id: "build_implementation_start",
        label: "Start Implementation",
        ...fresh(),
        template: { kind: "kickoff", id: "messages.build_start" },
        targetBranch: true,
      },
      {
        id: "build_after_qa_rejected",
        label: "Fix QA Rejection",
        ...freshOrReuse(),
        template: { kind: "kickoff", id: "messages.build_after_qa_rejection" },
        selectWhen: qaRejected,
        requiresWorktree: true,
      },
      {
        id: "build_after_human_request_changes",
        label: "Apply Human Changes",
        ...freshOrReuse(),
        template: { kind: "kickoff", id: "messages.build_requested_changes" },
        selectWhen: { stateIn: ["human_review"] },
        context: "human_feedback",
        requiresWorktree: true,
        surface: "studio",
        showWhen: false,
        description: "Address human review feedback.",
      },
      {
        id: "build_pull_request_generation",
        label: "Generate Pull Request",
        startModes: ["reuse", "fork"],
        defaultStartMode: "reuse",
        template: { kind: "kickoff", id: "messages.build_pull_request" },
        context: "pull_request",
        targetBranch: true,
        requiresWorktree: true,
        surface: "studio",
        showWhen: { stateIn: ["human_review"] },
        description: "Generate or update the pull request.",
      },
      {
        id: "build_rebase_conflict_resolution",
        label: "Resolve Git Conflict",
        ...freshOrReuse(),
        template: { kind: "message", id: "messages.build_git_conflict" },
        requiresWorktree: true,
        surface: "git_conflict",
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
    displayRules: [
      { when: qaRejected, session: ["none", "idle", "stopped"], completion: "rejected" },
      { when: { all: [{ stateIn: ["in_progress"] }, qaRejected] }, completion: "rejected" },
      {
        when: { all: [{ stateIn: ["ai_review"] }, { artifact: "qaReport", verdict: "rejected" }] },
        session: ["none", "idle", "stopped"],
        completion: "rejected",
      },
    ],
    launchActions: [
      {
        id: "qa_review",
        label: "QA Review",
        ...freshOrReuse(),
        template: { kind: "kickoff", id: "messages.qa_review" },
      },
    ],
  },
] satisfies (WorkflowDefinition["steps"][number] & {
  kind: "agent";
  roleId: BuiltinRoleId;
  launchActions: SpecPlanBuildLaunchAction[];
  startEventId?: SpecPlanBuildTaskEventId;
})[];

/** Action labels are the default UI labels. Label variants and the Studio label adapt them. */
const specPlanBuildActions = [
  { id: "view_details", kind: "view", label: "View details", availableWhen: true, surfaces: [] },
  {
    id: "set_spec",
    kind: "session",
    label: "Start Spec",
    stepId: "specification",
    eventId: "set-spec",
    launchActionIds: ["spec_initial"],
    // A ready spec continues in its session through open_spec.
    availableWhen: { not: { stateIn: ["spec_ready"] } },
    icon: "specification",
  },
  {
    id: "set_plan",
    kind: "session",
    label: "Start Planner",
    stepId: "planning",
    eventId: "set-plan",
    launchActionIds: ["planner_initial"],
    availableWhen: true,
    icon: "planning",
  },
  {
    id: "qa_start",
    kind: "session",
    label: "Request QA Review",
    stepId: "quality-review",
    launchActionIds: ["qa_review"],
    availableWhen: qaAvailable,
    icon: "quality",
    emphasis: "prominent",
  },
  {
    id: "build_start",
    kind: "session",
    label: "Start Builder",
    labels: [{ when: qaRejected, label: "Address QA Feedbacks" }],
    stepId: "implementation",
    launchActionIds: ["build_implementation_start", "build_after_qa_rejected"],
    availableWhen: { any: [qaRejected, { all: [{ not: activeOrReview }, buildAvailable] }] },
    icon: "building",
    emphasis: "prominent",
    studioLabel: "Start Implementation",
  },
  {
    id: "open_spec",
    kind: "view",
    label: "Open Spec",
    stepId: "specification",
    availableWhen: { stateIn: ["spec_ready"] },
    icon: "open",
  },
  // A task card also shows a session view action when its role has a session.
  {
    id: "open_planner",
    kind: "view",
    label: "Open Planner",
    stepId: "planning",
    availableWhen: false,
    icon: "open",
  },
  {
    id: "open_builder",
    kind: "view",
    label: "Open Builder",
    stepId: "implementation",
    availableWhen: activeOrReview,
    icon: "open",
  },
  {
    id: "reset_implementation",
    kind: "event",
    label: "Reset Implementation",
    eventId: "reset-implementation",
    availableWhen: true,
    icon: "reset",
    emphasis: "destructive",
  },
  {
    id: "open_qa",
    kind: "view",
    label: "Open QA",
    stepId: "quality-review",
    availableWhen: qaRejected,
    icon: "open",
  },
  {
    id: "human_request_changes",
    kind: "event",
    label: "Request Changes",
    eventId: "human-request-changes",
    launchActionIds: ["build_after_human_request_changes"],
    availableWhen: humanReview,
    icon: "undo",
  },
  {
    id: "human_approve",
    kind: "approval",
    label: "Approve Task",
    availableWhen: humanReview,
    icon: "complete",
    emphasis: "prominent",
  },
] satisfies SpecPlanBuildAction[];

const specPlanBuildSignals = [
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
] satisfies SpecPlanBuildSignal[];

const specPlanBuildAutomations = [
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
] satisfies SpecPlanBuildAutomation[];

const automationGuidance =
  "Define enough detail for Planner/Builder automation to execute with minimal ambiguity.";
const specPlanBuildIssueTypes = [
  {
    id: "feature",
    label: "Feature",
    description: "User-facing capability or workflow improvement.",
    guidance: automationGuidance,
    icon: "feature",
  },
  {
    id: "bug",
    label: "Bug",
    description: "Unexpected behavior, regression, or production defect.",
    guidance: "Capture reproduction context, impact, and a concrete fix target.",
    icon: "bug",
  },
  {
    id: "task",
    label: "Task",
    description: "Standard implementation work item.",
    guidance: automationGuidance,
    icon: "task",
  },
] satisfies WorkflowIssueTypeDefinition[];

const secondaryActions: SpecPlanBuildActionId[] = [
  "open_spec",
  "open_planner",
  "open_builder",
  "open_qa",
  "human_approve",
  "human_request_changes",
  "reset_implementation",
];

/** The source of the Spec, Plan, Build definition. */
export const SPEC_PLAN_BUILD_DEFINITION = {
  schemaVersion: 1,
  id: "openducktor-spec-plan-build",
  revision: 2,
  label: "Spec, Plan, Build",
  facts: [],
  issueTypes: specPlanBuildIssueTypes,
  defaultIssueType: "task",
  roles: specPlanBuildRoles,
  artifacts: specPlanBuildArtifacts,
  states: specPlanBuildStates,
  steps: specPlanBuildSteps,
  actions: specPlanBuildActions,
  events: Object.entries(specPlanBuildEvents).map(([id, event]) => ({ id, ...event })),
  signals: specPlanBuildSignals,
  automations: specPlanBuildAutomations,
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
  launchOrder: [
    {
      when: { stateIn: ["human_review"] },
      pullRequest: true,
      order: [
        "build_after_human_request_changes",
        "qa_review",
        "build_implementation_start",
        "spec_initial",
        "planner_initial",
        "build_pull_request_generation",
      ],
    },
    {
      when: { stateIn: ["human_review"] },
      pullRequest: false,
      order: [
        "build_pull_request_generation",
        "build_after_human_request_changes",
        "qa_review",
        "build_implementation_start",
        "spec_initial",
        "planner_initial",
      ],
    },
  ],
} satisfies WorkflowDefinition;
