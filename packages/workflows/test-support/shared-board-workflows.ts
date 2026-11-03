import {
  taskCardSchema,
  type TaskCard,
  type WorkflowBoardDefinition,
  type AgentRoleDefinition,
  type WorkflowDefinition,
} from "@openducktor/contracts";
import { createTaskWorkflow, type TaskWorkflow } from "../src/task-workflow/task-workflow";
import { resolveWorkflowTaskCards, type ResolvedTaskCard } from "../src/task-workflow-view";
import {
  resolveWorkflowBoard,
  taskWorkflowDescriptor,
  workflowReferenceKey,
  workflowRoleCatalog,
  type WorkflowBoardLayout,
} from "../src/workflow-catalog";

const publishingWorkflow = (prefix: "alpha" | "beta") => {
  const writer = `${prefix}_writer`;
  const editor = `${prefix}_editor`;
  const draft = `${prefix}_draft`;
  const review = `${prefix}_review`;
  const queue = `${prefix}_queue`;
  const work = `${prefix}_work`;
  const hold = `${prefix}_hold`;
  const approval = `${prefix}_approval`;
  const shelved = `${prefix}_shelved`;
  const open = [queue, work, hold, "shared_review", approval];
  const move = (to: string) => [{ when: true, to }];
  const definition: WorkflowDefinition = {
    schemaVersion: 1,
    id: prefix,
    revision: 1,
    label: `${prefix} publishing`,
    initialState: queue,
    facts: [],
    issueTypes: [
      { id: "article", label: "Article", icon: "feature" },
      { id: "fix", label: "Fix", icon: "bug" },
    ],
    roles: [
      { id: writer, writes: [draft] },
      { id: editor, writes: [review] },
    ],
    artifacts: [
      { id: draft, label: `${prefix} Draft`, kind: "document", saveEventId: `${prefix}_submit` },
      {
        id: review,
        label: `${prefix} Review`,
        kind: "review",
        verdicts: [
          { id: "accept", label: "Accepted", passes: true, eventId: `${prefix}_accept` },
          { id: "revise", label: "Revise", passes: false, eventId: `${prefix}_revise` },
        ],
      },
    ],
    states: [
      { id: queue, label: "Backlog", studioRole: writer },
      { id: work, label: "Writing", studioRole: writer },
      { id: hold, label: "Paused", studioRole: writer },
      {
        id: "shared_review",
        label: "Review",
        tone: "review",
        studioRole: editor,
        notification: {
          kind: `workflow.${prefix}.review`,
          defaultSetting: { enabled: true, target: "in_app", sound: "none" },
          label: `${prefix} review`,
          description: `Review a ${prefix} draft.`,
          title: `${prefix} review`,
          body: `Review the ${prefix} draft.`,
          status: "Draft ready for review.",
          route: "agent_studio",
          role: editor,
        },
      },
      { id: approval, label: "Approval" },
      { id: "shared_done", label: "Published", terminal: true, tone: "success" },
      { id: shelved, label: "Shelved", terminal: true },
    ],
    steps: [
      {
        id: `${prefix}_write`,
        label: `${prefix} Writer`,
        kind: "agent",
        roleId: writer,
        startEventId: `${prefix}_start`,
        inputs: [],
        outputs: [draft],
        requiredWhen: true,
        availableWhen: { stateIn: open },
        completedWhen: { artifact: draft, present: true },
        launchActions: [
          {
            id: `${prefix}_write_start`,
            label: `${prefix} Write`,
            startModes: ["fresh"],
            defaultStartMode: "fresh",
            template: { kind: "kickoff", id: `${prefix}.kickoff.write_start` },
            targetBranch: true,
          },
          {
            id: `${prefix}_write_revise`,
            label: `${prefix} Revise`,
            startModes: ["fresh", "reuse", "fork"],
            defaultStartMode: "reuse",
            template: { kind: "kickoff", id: `${prefix}.kickoff.write_revise` },
            context: "human_feedback",
            selectWhen: { artifact: review, verdict: "revise" },
          },
        ],
      },
      {
        id: `${prefix}_edit`,
        label: `${prefix} Editor`,
        kind: "agent",
        roleId: editor,
        inputs: [draft],
        outputs: [review],
        requiredWhen: true,
        availableWhen: { stateIn: ["shared_review", approval] },
        completedWhen: { artifact: review, verdict: "accept" },
        launchActions: [
          {
            id: `${prefix}_edit_review`,
            label: `${prefix} Review draft`,
            startModes: prefix === "alpha" ? ["fresh", "reuse"] : ["fresh"],
            defaultStartMode: "fresh",
            template: { kind: "kickoff", id: `${prefix}.kickoff.edit_review` },
          },
        ],
      },
      {
        id: `${prefix}_signoff`,
        label: `${prefix} sign-off`,
        kind: "human",
        inputs: [review],
        outputs: [],
        requiredWhen: true,
        availableWhen: { stateIn: [approval] },
        completedWhen: { stateIn: ["shared_done"] },
      },
    ],
    actions: [
      {
        id: `${prefix}_start_write`,
        label: `${prefix} Write`,
        kind: "session",
        stepId: `${prefix}_write`,
        launchActionIds: [`${prefix}_write_start`, `${prefix}_write_revise`],
        availableWhen: { stateIn: [queue, work, hold] },
      },
      {
        id: `${prefix}_request_review`,
        label: `${prefix} Review`,
        kind: "session",
        stepId: `${prefix}_edit`,
        launchActionIds: [`${prefix}_edit_review`],
        availableWhen: { stateIn: ["shared_review"] },
      },
      {
        id: `${prefix}_hold`,
        label: `${prefix} Hold`,
        kind: "event",
        eventId: `${prefix}_hold`,
        availableWhen: { stateIn: [prefix === "alpha" ? "shared_review" : approval] },
      },
      {
        id: `${prefix}_approve`,
        label: `${prefix} Approve`,
        kind: "event",
        eventId: `${prefix}_approve`,
        availableWhen: { stateIn: [approval] },
      },
      {
        id: `${prefix}_shelve`,
        label: `${prefix} Shelve`,
        kind: "event",
        eventId: `${prefix}_shelve`,
        availableWhen: true,
      },
    ],
    events: [
      {
        id: `${prefix}_start`,
        from: [queue, work, hold],
        guards: [],
        outcomes: move(work),
        effect: "build.start",
      },
      { id: `${prefix}_submit`, from: open, guards: [], outcomes: move("shared_review") },
      { id: `${prefix}_accept`, from: ["shared_review"], guards: [], outcomes: move(approval) },
      { id: `${prefix}_revise`, from: ["shared_review"], guards: [], outcomes: move(work) },
      { id: `${prefix}_hold`, from: ["shared_review", approval], guards: [], outcomes: move(hold) },
      {
        id: `${prefix}_approve`,
        from: [approval],
        guards: [
          {
            id: "accepted",
            when: { artifact: review, verdict: "accept" },
            message: "Accept the review first.",
          },
        ],
        outcomes: move("shared_done"),
      },
      {
        id: `${prefix}_shelve`,
        from: open,
        guards: [],
        outcomes: move(shelved),
        effect: "task.close",
      },
    ],
    signals: [],
    automations: [],
    actionOrder: [],
    actionPriority: [],
    launchOrder: [],
    prompts: {
      system: [`${prefix}.system.task`],
      readOnlyRejection: `${prefix}.permission.read_only`,
    },
  };
  const templates = [
    {
      id: `${prefix}.system.task`,
      purpose: "system" as const,
      builtinVersion: 1,
      template: `${prefix} task {{task.id}}: {{task.title}}\nTools:\n{{role.allowedTools}}`,
    },
    {
      id: `${prefix}.permission.read_only`,
      purpose: "permission" as const,
      builtinVersion: 1,
      template: `${prefix}: the {{role}} cannot change files.`,
    },
  ];
  const systemPrompt = (role: string) => ({
    id: `system.role.${role}.base`,
    builtinVersion: 1,
    template: `${prefix}: work on {{task.id}} as {{role}}.`,
    label: `${role} base`,
    description: "",
  });
  const roles: AgentRoleDefinition[] = [
    {
      id: writer,
      label: `${prefix} Writer`,
      tools: ["odt_read_task", "odt_read_task_artifacts", "odt_set_task_artifact"],
      workspaceAccess: "write",
      location: "task_worktree",
      runtimeScopes: ["build"],
      systemPrompt: systemPrompt(writer),
    },
    {
      id: editor,
      label: `${prefix} Editor`,
      tools: ["odt_read_task", "odt_read_task_artifacts", "odt_set_task_artifact"],
      workspaceAccess: "read",
      location: "repository",
      runtimeScopes: ["workspace"],
      systemPrompt: systemPrompt(editor),
    },
  ];
  const kickoffs = ["write_start", "write_revise", "edit_review"].map((action) => ({
    id: `${prefix}.kickoff.${action}`,
    purpose: "kickoff" as const,
    builtinVersion: 1,
    template: `${prefix}: ${action} for {{task.id}}.`,
  }));
  return createTaskWorkflow(definition, [...templates, ...kickoffs], roles);
};

/** Two injected workflows share Review and Done, with their own roles, artifacts, and actions. */
export const createSharedBoardWorkflows = () => {
  const alpha = publishingWorkflow("alpha");
  const beta = publishingWorkflow("beta");
  const workflows = [alpha, beta];
  const order = [
    "alpha_queue",
    "beta_queue",
    "beta_work",
    "alpha_hold",
    "shared_review",
    "alpha_work",
    "beta_hold",
    "alpha_approval",
    "beta_approval",
    "shared_done",
    "alpha_shelved",
    "beta_shelved",
  ];
  const layout: WorkflowBoardLayout = {
    states: order.map((id) => ({ id, taskOrder: "updated" })),
  };
  const board = resolveWorkflowBoard(layout, workflows);
  return {
    alpha,
    beta,
    workflows,
    layout,
    board,
    catalog: {
      hostInstanceId: "mixed-host",
      roles: [...workflowRoleCatalog(workflows)],
      workflows: workflows.map(taskWorkflowDescriptor),
    },
  };
};

/** A host projection joined to its compiled workflow and explicit shared board. */
export const createWorkflowTaskCardFixture = (
  workflow: TaskWorkflow,
  board: WorkflowBoardDefinition,
  overrides: Partial<TaskCard> = {},
): ResolvedTaskCard => {
  const record = {
    id: "task-1",
    title: "Task",
    description: "",
    priority: 2,
    issueType: workflow.issueTypes[0]!,
    status: workflow.initialState,
    labels: [],
    removeWorktreeOnClose: null,
    artifactSummary: workflow.emptyArtifactSummary(),
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    ...overrides,
  };
  const card = taskCardSchema.parse({ ...record, ...workflow.project(record), ...overrides });
  return resolveWorkflowTaskCards(
    {
      hostInstanceId: "fixture-host",
      roles: workflowRoleCatalog([workflow]),
      workflows: new Map([[workflowReferenceKey(workflow.reference), workflow]]),
    },
    {
      hostInstanceId: "fixture-host",
      board,
      workflows: [workflow.reference],
      newTaskWorkflow: workflow.reference,
    },
    [card],
  )[0]!;
};
