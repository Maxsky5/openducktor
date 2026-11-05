import type { WorkflowDefinition, WorkflowInput } from "@openducktor/contracts";

const review = (approvedEventId: string) =>
  [
    { id: "approved", label: "Approved", passes: true, eventId: approvedEventId },
    { id: "changes", label: "Changes requested", passes: false, eventId: "return-draft" },
  ] as const;

export const publicationDefinition = (): WorkflowDefinition => ({
  schemaVersion: 1,
  id: "publication",
  revision: 2,
  label: "Publication",
  facts: [
    { id: "hold", type: "boolean" },
    { id: "edition", type: "number" },
    { id: "owner", type: "string" },
    { id: "channel", type: "enum", values: ["web", "print", null] },
  ],
  roles: [
    { id: "author", writes: ["copy"] },
    { id: "reviewer", writes: ["first-review", "second-review"] },
  ],
  artifacts: [
    { id: "copy", label: "Copy", kind: "document", saveEventId: "submit" },
    {
      id: "first-review",
      label: "First review",
      kind: "review",
      verdicts: [...review("finish-first")],
    },
    {
      id: "second-review",
      label: "Second review",
      kind: "review",
      verdicts: [...review("finish-second")],
    },
    { id: "approval", label: "Approval", kind: "document" },
  ],
  states: [
    { id: "open", label: "Draft", studioRole: "author" },
    {
      id: "first-review",
      label: "First review",
      notification: {
        kind: "workflow.first_review",
        defaultSetting: { enabled: true, target: "both", sound: "inherit" },
        label: "First review",
        description: "The copy moves to its first review.",
        title: "Ready for review",
        body: "Review the submitted copy.",
        status: "Copy moved to First review.",
        route: "agent_studio",
        role: "reviewer",
      },
    },
    { id: "second-review", label: "Second review" },
    { id: "human-approval", label: "Human approval", shortLabel: "Approval" },
    { id: "closed", label: "Published" },
  ],
  steps: [
    {
      id: "write",
      label: "Write the copy",
      kind: "agent",
      roleId: "author",
      inputs: [],
      outputs: ["copy"],
      requiredWhen: true,
      availableWhen: { stateIn: ["open"] },
      completedWhen: { artifact: "copy", present: true },
      launchActions: [
        {
          id: "write-draft",
          label: "Write draft",
          startModes: ["fresh"],
          defaultStartMode: "fresh",
          template: { kind: "kickoff", id: "messages.write" },
        },
        {
          id: "revise-draft",
          label: "Revise draft",
          startModes: ["fresh", "reuse", "fork"],
          defaultStartMode: "reuse",
          template: { kind: "kickoff", id: "messages.revise" },
          selectWhen: { artifact: "first-review", verdict: "changes" },
          context: "human_feedback",
          requiresWorktree: true,
        },
      ],
    },
    {
      id: "review-first",
      label: "Review the draft",
      kind: "agent",
      roleId: "reviewer",
      inputs: ["copy"],
      outputs: ["first-review"],
      requiredWhen: true,
      availableWhen: { stateIn: ["first-review"] },
      completedWhen: { artifact: "first-review", verdict: "approved" },
      launchActions: [
        {
          id: "review-first",
          label: "First review",
          startModes: ["fresh"],
          defaultStartMode: "fresh",
          template: { kind: "kickoff", id: "messages.review" },
        },
      ],
    },
    {
      id: "review-second",
      label: "Review the final copy",
      kind: "agent",
      roleId: "reviewer",
      inputs: ["copy", "first-review"],
      outputs: ["second-review"],
      requiredWhen: {
        any: [
          { fact: "edition", equals: 2 },
          { artifact: "copy", present: true },
        ],
      },
      availableWhen: { stateIn: ["second-review"] },
      completedWhen: { artifact: "second-review", verdict: "approved" },
      launchActions: [
        {
          id: "review-second",
          label: "Second review",
          startModes: ["fresh", "fork"],
          defaultStartMode: "fork",
          template: { kind: "message", id: "messages.review_message" },
        },
      ],
    },
    {
      id: "approve",
      label: "Approve publication",
      kind: "human",
      inputs: ["first-review", "second-review"],
      outputs: ["approval"],
      requiredWhen: true,
      availableWhen: { stateIn: ["human-approval"] },
      completedWhen: { artifact: "approval", present: true },
    },
  ],
  actions: [
    {
      id: "submit",
      label: "Submit",
      kind: "event",
      stepId: "write",
      eventId: "submit",
      availableWhen: true,
    },
    {
      id: "start-writing",
      label: "Start writing",
      labels: [{ when: { artifact: "first-review", verdict: "changes" }, label: "Revise copy" }],
      kind: "session",
      stepId: "write",
      launchActionIds: ["write-draft", "revise-draft"],
      availableWhen: { stateIn: ["open"] },
    },
    {
      id: "finish-first",
      label: "Finish first review",
      kind: "event",
      stepId: "review-first",
      eventId: "finish-first",
      availableWhen: true,
    },
    {
      id: "finish-second",
      label: "Finish second review",
      kind: "event",
      stepId: "review-second",
      eventId: "finish-second",
      availableWhen: true,
    },
    {
      id: "publish",
      label: "Publish",
      kind: "event",
      stepId: "approve",
      eventId: "publish",
      availableWhen: { not: { fact: "hold", equals: true } },
    },
    { id: "view-copy", label: "View copy", kind: "view", availableWhen: true },
  ],
  events: [
    {
      id: "submit",
      from: ["open"],
      guards: [{ id: "draft-ready", when: { artifact: "copy", present: true } }],
      outcomes: [{ when: true, to: "first-review", signal: "copySubmitted", sourceRole: "author" }],
    },
    {
      id: "finish-first",
      from: ["first-review"],
      guards: [{ id: "first-reviewed", when: { artifact: "first-review", verdict: "approved" } }],
      outcomes: [{ when: true, to: "second-review" }],
    },
    {
      id: "finish-second",
      from: ["second-review"],
      guards: [{ id: "second-reviewed", when: { artifact: "second-review", verdict: "approved" } }],
      outcomes: [
        { when: true, to: "human-approval", signal: "readyForApproval", sourceRole: "reviewer" },
      ],
    },
    {
      id: "return-draft",
      from: ["first-review", "second-review"],
      guards: [],
      outcomes: [{ when: true, to: "open", signal: "changesRequested" }],
    },
    {
      id: "publish",
      from: ["human-approval"],
      guards: [
        { id: "first-reviewed", when: { artifact: "first-review", verdict: "approved" } },
        { id: "second-reviewed", when: { artifact: "second-review", verdict: "approved" } },
        { id: "approved", when: { artifact: "approval", present: true } },
      ],
      outcomes: [{ when: true, to: "closed" }],
    },
  ],
  signals: [
    {
      id: "copySubmitted",
      label: "When the copy is submitted",
      description: "Runs when a submission moves the copy to its first review.",
      automations: ["startFirstReview"],
    },
    {
      id: "readyForApproval",
      label: "When the copy is ready for approval",
      description: "Runs when the second review passes.",
      automations: [],
    },
    {
      id: "changesRequested",
      label: "When a review requests changes",
      description: "Runs when a review sends the copy back to the draft.",
      automations: ["startRevision"],
    },
  ],
  automations: [
    {
      id: "startFirstReview",
      label: "Start the first review",
      description: "Starts the first review.",
      launchActionId: "review-first",
    },
    {
      id: "startRevision",
      label: "Start the revision",
      description: "Forks the latest author session to revise the copy.",
      launchActionId: "revise-draft",
      startMode: "fork",
    },
  ],
  actionOrder: [
    { when: { fact: "hold", equals: true }, actions: ["view-copy", "submit"] },
    { when: true, actions: ["publish", "submit", "finish-first", "view-copy"] },
  ],
  actionPriority: [{ when: { stateIn: ["open"] }, actions: ["start-writing", "submit"] }],
});

export type Artifacts = WorkflowInput["artifacts"];

export const publicationInput = (
  state: string,
  facts: WorkflowInput["facts"] = {},
  artifacts: Artifacts = {},
): WorkflowInput => ({
  workflowId: "publication",
  definitionRevision: 2,
  state,
  facts,
  artifacts,
});

export const noArtifacts = (): Artifacts => ({
  copy: { present: false },
  "first-review": { present: false },
  "second-review": { present: false },
  approval: { present: false },
});

export const completedArtifacts = (): Artifacts => ({
  copy: { present: true },
  "first-review": { present: true, verdict: "approved" },
  "second-review": { present: true, verdict: "approved" },
  approval: { present: true },
});
