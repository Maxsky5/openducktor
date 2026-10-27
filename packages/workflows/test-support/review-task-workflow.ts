import type { WorkflowDefinition } from "@openducktor/contracts";
import { createTaskWorkflow, type TaskWorkflow } from "../src/task-workflow/task-workflow";
import type { PromptTemplate } from "../src/task-workflow/task-prompts";

const drafted = { artifact: "draft", present: true } as const;
const accepted = { artifact: "review", verdict: "accept" } as const;
const revised = { artifact: "review", verdict: "revise" } as const;
const open = ["backlog", "writing", "paused", "reviewing", "approval"];

/**
 * A second task workflow for tests. Its IDs differ from the built-in IDs, and it has two
 * terminal states, so a test catches code that assumes the built-in workflow.
 */
export const reviewTaskDefinition = (): WorkflowDefinition => ({
  schemaVersion: 1,
  id: "review",
  revision: 1,
  label: "Review",
  initialState: "backlog",
  facts: [{ id: "issueType", type: "enum", values: ["article", "fix"] }],
  roles: [
    {
      id: "writer",
      label: "Writer",
      tools: [
        "odt_read_task",
        "odt_read_task_artifacts",
        "odt_set_task_artifact",
        "odt_build_blocked",
        "odt_build_resumed",
        "odt_build_completed",
      ],
      writes: ["draft"],
      workspaceAccess: "write",
      location: "task_worktree",
      runtimeScopes: ["build"],
    },
    {
      id: "editor",
      label: "Editor",
      tools: ["odt_read_task", "odt_read_task_artifacts", "odt_set_task_artifact"],
      writes: ["review"],
      workspaceAccess: "read",
      location: "repository",
      runtimeScopes: ["workspace"],
    },
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
    { id: "backlog", label: "Backlog" },
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
    { id: "approval", label: "Approval" },
    {
      id: "published",
      label: "Published",
      terminal: true,
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
    { id: "shelved", label: "Shelved", terminal: true },
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
      availableWhen: { stateIn: open },
      completedWhen: drafted,
      launchActions: [
        {
          id: "write_start",
          label: "Start writing",
          startModes: ["fresh"],
          defaultStartMode: "fresh",
          template: { kind: "kickoff", id: "kickoff.write_start" },
          targetBranch: true,
        },
        {
          id: "write_revise",
          label: "Revise draft",
          startModes: ["fresh", "reuse", "fork"],
          defaultStartMode: "reuse",
          template: { kind: "kickoff", id: "kickoff.write_revise" },
          selectWhen: revised,
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
          template: { kind: "kickoff", id: "kickoff.edit_review" },
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
      availableWhen: { stateIn: ["backlog", "writing", "paused"] },
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
      kind: "event",
      label: "Approve",
      eventId: "approve-copy",
      availableWhen: true,
    },
    { id: "shelve", kind: "event", label: "Shelve", eventId: "shelve", availableWhen: true },
    { id: "restart", kind: "event", label: "Restart", eventId: "restart", availableWhen: true },
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
      id: "move-writing",
      from: ["backlog", "paused"],
      guards: [],
      outcomes: [{ when: true, to: "writing" }],
      effect: "status.set",
    },
    {
      id: "hold",
      from: ["reviewing", "approval"],
      guards: [],
      outcomes: [{ when: true, to: "paused" }],
    },
    {
      id: "move-approval",
      from: ["reviewing"],
      guards: [],
      outcomes: [{ when: true, to: "approval" }],
      effect: "status.set",
    },
    {
      id: "start-writing",
      from: ["backlog", "writing", "paused"],
      guards: [],
      outcomes: [
        { when: { stateIn: ["backlog"] }, to: "writing" },
        { when: true, to: null },
      ],
      effect: "build.start",
    },
    {
      id: "submit-draft",
      from: open,
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
      effect: "build.completed",
    },
    {
      id: "pause-writing",
      from: ["writing", "paused"],
      guards: [],
      outcomes: [{ when: true, to: "paused" }],
      effect: "build.blocked",
    },
    {
      id: "resume-writing",
      from: ["paused", "writing"],
      guards: [],
      outcomes: [{ when: true, to: "writing" }],
      effect: "build.resumed",
    },
    {
      id: "approve-copy",
      from: ["approval", "published"],
      guards: [],
      outcomes: [{ when: true, to: "published" }],
      effect: "review.approve",
    },
    {
      id: "request-rewrite",
      from: ["approval"],
      guards: [],
      outcomes: [{ when: true, to: "writing" }],
      effect: "review.request_changes",
    },
    {
      id: "shelve",
      from: [...open, "shelved"],
      guards: [],
      outcomes: [{ when: true, to: "shelved" }],
      effect: "task.close",
    },
    {
      id: "restart",
      from: open,
      guards: [],
      outcomes: [{ when: true, to: "backlog" }],
      effect: "task.reset",
    },
    {
      id: "drop-review",
      from: ["writing", "paused", "reviewing", "approval"],
      guards: [],
      outcomes: [{ when: true, to: "writing" }],
      effect: "implementation.reset",
    },
    {
      id: "manage-pr",
      from: ["writing", "approval"],
      guards: [],
      outcomes: [{ when: true, to: null }],
      effect: "pull_request.manage",
    },
    {
      id: "pr-merged",
      from: ["approval", "published"],
      guards: [],
      outcomes: [{ when: true, to: "published" }],
      effect: "pull_request.merged",
    },
    {
      id: "merge-local",
      from: ["approval"],
      guards: [],
      outcomes: [{ when: true, to: "published" }],
      effect: "direct_merge.local",
    },
    {
      id: "merge-publish",
      from: ["approval"],
      guards: [],
      outcomes: [{ when: true, to: "approval" }],
      effect: "direct_merge.publish",
    },
    {
      id: "merge-done",
      from: ["approval", "published"],
      guards: [],
      outcomes: [{ when: true, to: "published" }],
      effect: "direct_merge.completed",
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
  actionOrder: [
    { when: true, actions: ["start_write", "request_review", "approve", "shelve", "restart"] },
  ],
  actionPriority: [],
});

const template = (
  id: string,
  purpose: PromptTemplate["purpose"],
  text: string,
): PromptTemplate => ({ id, purpose, builtinVersion: 1, template: text });

export const reviewTaskPromptTemplates: readonly PromptTemplate[] = [
  template("system.role.writer.base", "system", "You are the {{role}} of task {{task.id}}."),
  template("system.role.editor.base", "system", "You review task {{task.id}} as {{role}}."),
  template("system.shared.workflow_guards", "system", "Follow the review workflow."),
  template("system.shared.tool_protocol", "system", "Tools:\n{{role.allowedTools}}"),
  template(
    "system.shared.task_context",
    "system",
    "Task {{task.id}}: {{task.title}} ({{task.issueType}}, {{task.status}})",
  ),
  template("permission.read_only.reject", "permission", "The {{role}} cannot change files."),
  template("kickoff.write_start", "kickoff", "Write the draft for {{task.id}}."),
  template("kickoff.write_revise", "kickoff", "Revise the draft for {{task.id}}."),
  template("kickoff.edit_review", "kickoff", "Review the draft of {{task.id}}."),
];

export const createReviewTaskWorkflow = (): TaskWorkflow =>
  createTaskWorkflow(reviewTaskDefinition(), reviewTaskPromptTemplates);
