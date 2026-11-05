import type { AgentRoleDefinition, WorkflowDefinition } from "@openducktor/contracts";
import { createTaskWorkflow, type TaskWorkflow } from "../src/task-workflow/task-workflow";
import type { PromptTemplate } from "../src/task-workflow/task-prompts";

const drafted = { artifact: "draft", present: true } as const;
const accepted = { artifact: "review", verdict: "accept" } as const;
const revised = { artifact: "review", verdict: "revise" } as const;
const active = ["open", "writing", "paused", "reviewing", "approval"];

/**
 * A second task workflow for tests. Its IDs differ from the built-in IDs, except the core states,
 * so a test catches code that assumes the built-in workflow.
 */
export const reviewTaskDefinition = (): WorkflowDefinition => ({
  schemaVersion: 1,
  id: "review",
  revision: 1,
  label: "Review",
  facts: [],
  issueTypes: [
    { id: "feature", label: "Article" },
    { id: "bug", label: "Fix" },
  ],
  roles: [
    { id: "writer", writes: ["draft"] },
    { id: "editor", writes: ["review"] },
  ],
  artifacts: [
    { id: "draft", label: "Draft", kind: "document", saveEventId: "submit-draft" },
    {
      id: "review",
      label: "Editorial review",
      shortLabel: "Review",
      kind: "review",
      verdicts: [
        { id: "accept", label: "Accepted", passes: true, eventId: "accept-review" },
        { id: "revise", label: "Revise", passes: false, eventId: "revise-review" },
      ],
    },
  ],
  states: [
    { id: "open", label: "Backlog" },
    { id: "writing", label: "Writing", studioRole: "writer" },
    { id: "paused", label: "Paused" },
    {
      id: "reviewing",
      label: "Reviewing",
      notification: {
        kind: "workflow.reviewing",
        defaultSetting: { enabled: true, target: "both", sound: "inherit" },
        label: "Reviewing",
        description: "A task moves to Reviewing.",
        title: "Ready for review",
        body: "Review the draft.",
        status: "Task moved to Reviewing.",
        route: "agent_studio",
        role: "editor",
      },
    },
    { id: "approval", label: "Approval", mergeDetection: true },
    {
      id: "closed",
      label: "Done",
      tone: "success",
      notification: {
        kind: "workflow.published",
        defaultSetting: { enabled: true, target: "in_app", sound: "none" },
        label: "Published",
        description: "A task is published.",
        title: "Published",
        body: "The task is published.",
        status: "Task moved to Published.",
        route: "kanban",
      },
    },
  ],
  steps: [
    {
      id: "write",
      label: "Writer",
      kind: "agent",
      roleId: "writer",
      startEventId: "start-writing",
      inputs: [],
      outputs: ["draft"],
      requiredWhen: true,
      availableWhen: { stateIn: active },
      completedWhen: drafted,
      launchActions: [
        {
          id: "write_start",
          label: "Start writing",
          startModes: ["fresh"],
          defaultStartMode: "fresh",
          template: { kind: "kickoff", id: "messages.write_start" },
          targetBranch: true,
        },
        {
          id: "write_revise",
          label: "Revise draft",
          startModes: ["fresh", "reuse", "fork"],
          defaultStartMode: "reuse",
          template: { kind: "kickoff", id: "messages.write_revise" },
          selectWhen: revised,
          requiresWorktree: true,
        },
        {
          id: "write_feedback",
          label: "Apply feedback",
          startModes: ["fresh", "reuse"],
          defaultStartMode: "reuse",
          template: { kind: "kickoff", id: "messages.write_feedback" },
          context: "human_feedback",
          requiresWorktree: true,
        },
      ],
    },
    {
      id: "edit",
      label: "Editor",
      kind: "agent",
      roleId: "editor",
      inputs: ["draft"],
      outputs: ["review"],
      requiredWhen: true,
      availableWhen: { stateIn: ["reviewing", "approval"] },
      completedWhen: accepted,
      launchActions: [
        {
          id: "edit_review",
          label: "Review draft",
          startModes: ["fresh", "reuse"],
          defaultStartMode: "fresh",
          template: { kind: "kickoff", id: "messages.edit_review" },
        },
      ],
    },
  ],
  actions: [
    {
      id: "start_write",
      kind: "session",
      label: "Write",
      stepId: "write",
      launchActionIds: ["write_start", "write_revise"],
      availableWhen: { stateIn: ["open", "writing", "paused"] },
    },
    {
      id: "request_review",
      kind: "session",
      label: "Request review",
      stepId: "edit",
      launchActionIds: ["edit_review"],
      availableWhen: { stateIn: ["reviewing"] },
    },
    {
      id: "approve",
      kind: "approval",
      label: "Approve",
      availableWhen: { stateIn: ["approval"] },
    },
    {
      id: "request_rewrite",
      kind: "event",
      label: "Request rewrite",
      eventId: "request-rewrite",
      launchActionIds: ["write_feedback"],
      availableWhen: { stateIn: ["approval"] },
    },
    {
      id: "drop_review",
      kind: "event",
      label: "Drop review",
      eventId: "drop-review",
      availableWhen: { stateIn: ["writing", "paused", "reviewing", "approval"] },
    },
    {
      id: "hold",
      kind: "event",
      label: "Hold",
      eventId: "hold",
      availableWhen: { stateIn: ["approval"] },
    },
  ],
  events: [
    {
      id: "hold",
      from: ["reviewing", "approval"],
      guards: [],
      outcomes: [{ when: true, to: "paused" }],
    },
    {
      id: "start-writing",
      from: ["open", "writing", "paused"],
      guards: [],
      outcomes: [
        { when: { stateIn: ["open"] }, to: "writing" },
        { when: true, to: null },
      ],
    },
    {
      id: "submit-draft",
      from: active,
      guards: [],
      outcomes: [
        { when: { stateIn: ["writing"] }, to: "reviewing", signal: "draftSubmitted" },
        { when: true, to: null },
      ],
    },
    {
      id: "accept-review",
      from: ["reviewing"],
      guards: [],
      outcomes: [{ when: true, to: "approval", signal: "reviewAccepted", sourceRole: "editor" }],
    },
    {
      id: "revise-review",
      from: ["reviewing"],
      guards: [],
      outcomes: [{ when: true, to: "writing", signal: "reviewRejected" }],
    },
    {
      id: "finish-writing",
      from: ["writing", "paused", "reviewing"],
      guards: [{ id: "drafted", when: drafted, message: "Save the draft first" }],
      outcomes: [
        { when: { stateIn: ["reviewing"] }, to: null },
        { when: true, to: "reviewing", signal: "draftSubmitted", sourceRole: "writer" },
      ],
      agent: { roles: ["writer"], note: "optional", description: "Submit the draft for review." },
    },
    {
      id: "pause-writing",
      from: ["writing", "paused"],
      guards: [],
      outcomes: [{ when: true, to: "paused" }],
      agent: { roles: ["writer"], note: "required", description: "Pause the writing." },
    },
    {
      id: "resume-writing",
      from: ["paused", "writing"],
      guards: [],
      outcomes: [{ when: true, to: "writing" }],
      agent: { roles: ["writer"], note: "optional", description: "Resume the writing." },
    },
    {
      id: "request-rewrite",
      from: ["approval"],
      guards: [],
      outcomes: [{ when: true, to: "writing" }],
    },
    {
      id: "drop-review",
      from: ["writing", "paused", "reviewing", "approval"],
      guards: [],
      outcomes: [{ when: true, to: "writing" }],
      effects: ["worktree.reset"],
    },
  ],
  signals: [
    {
      id: "draftSubmitted",
      label: "When a draft is submitted",
      description: "Runs when a draft moves a task to Reviewing.",
      automations: ["startEditor"],
    },
    {
      id: "reviewAccepted",
      label: "When a review accepts the draft",
      description: "Runs when an editor accepts the draft.",
      automations: [],
    },
    {
      id: "reviewRejected",
      label: "When a review asks for a revision",
      description: "Runs when an editor asks for a revision.",
      automations: ["startRevision"],
    },
  ],
  automations: [
    {
      id: "startEditor",
      label: "Start Editor",
      description: "Start the editor review.",
      launchActionId: "edit_review",
    },
    {
      id: "startRevision",
      label: "Start Revision",
      description: "Fork the latest writer session to revise the draft.",
      launchActionId: "write_revise",
      startMode: "fork",
    },
  ],
  actionOrder: [{ when: true, actions: ["start_write", "request_review", "approve"] }],
  actionPriority: [],
  launchOrder: [],
});

const template = (
  id: string,
  purpose: PromptTemplate["purpose"],
  text: string,
): PromptTemplate => ({ id, purpose, builtinVersion: 1, template: text });

const systemPrompt = (label: string, text: string) => ({
  builtinVersion: 1,
  template: text,
  label,
  description: "",
});

/** The role catalog of the review workflow of the tests. */
export const reviewTaskRoles: readonly AgentRoleDefinition[] = [
  {
    id: "writer",
    label: "Writer",
    tools: [
      "odt_read_task",
      "odt_read_task_artifacts",
      "odt_set_task_artifact",
      "odt_apply_workflow_event",
    ],
    workspaceAccess: "write",
    location: "task_worktree",
    runtimeScopes: ["build"],
    systemPrompt: systemPrompt("Writer system prompt", "You are the {{role}} of task {{task.id}}."),
  },
  {
    id: "editor",
    label: "Editor",
    tools: ["odt_read_task", "odt_read_task_artifacts", "odt_set_task_artifact"],
    workspaceAccess: "read",
    location: "repository",
    runtimeScopes: ["workspace"],
    systemPrompt: systemPrompt("Editor system prompt", "You review task {{task.id}} as {{role}}."),
  },
];

export const reviewTaskPromptTemplates: readonly PromptTemplate[] = [
  template("workflow.rules", "system", "Follow the review workflow."),
  template("workflow.tool_rules", "system", "Tools:\n{{role.allowedTools}}"),
  template(
    "workflow.task_context",
    "system",
    "Task {{task.id}}: {{task.title}} ({{task.issueType}}, {{task.status}})",
  ),
  template("workflow.read_only_rejection", "permission", "The {{role}} cannot change files."),
  template("messages.write_start", "kickoff", "Write the draft for {{task.id}}."),
  template("messages.write_revise", "kickoff", "Revise the draft for {{task.id}}."),
  template("messages.edit_review", "kickoff", "Review the draft of {{task.id}}."),
  template("messages.write_feedback", "kickoff", "Apply this feedback: {{humanFeedback}}"),
];

export const createReviewTaskWorkflow = (): TaskWorkflow =>
  createTaskWorkflow(reviewTaskDefinition(), reviewTaskPromptTemplates, reviewTaskRoles);
