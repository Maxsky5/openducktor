import { describe, expect, test } from "bun:test";
import { promptOverrideKey, type WorkflowDefinition } from "@openducktor/contracts";
import {
  createReviewTaskWorkflow,
  reviewTaskDefinition,
  reviewTaskPromptTemplates,
  reviewTaskRoles,
} from "../../test-support/review-task-workflow";
import { builtinTaskWorkflow } from "../builtin/task-workflow";
import type { TaskFacts } from "./task-input";
import { createTaskWorkflow } from "./task-workflow";

const review = createReviewTaskWorkflow();

const reviewTask = (overrides: Partial<TaskFacts> = {}): TaskFacts => ({
  id: "task-1",
  status: "backlog",
  issueType: "feature",
  artifactSummary: review.emptyArtifactSummary(),
  ...overrides,
});

const withChange = (change: (definition: WorkflowDefinition) => void) => {
  const definition = reviewTaskDefinition();
  change(definition);
  return () => createTaskWorkflow(definition, reviewTaskPromptTemplates, reviewTaskRoles);
};

describe("createTaskWorkflow", () => {
  test("reads states, roles, artifacts, and issue types from the definition", () => {
    expect(review.issueTypes).toEqual(["feature", "bug"]);
    expect(review.initialState).toBe("backlog");
    expect(review.terminalStates).toEqual(["published", "shelved"]);
    expect(review.isTerminalState("shelved")).toBe(true);
    expect(review.isTerminalState("approval")).toBe(false);
    expect(review.detectsMerge("approval")).toBe(true);
    expect(review.detectsMerge("reviewing")).toBe(false);
    expect(review.worktreeRoles).toEqual(["writer"]);
    expect(review.reviewArtifactCodes).toEqual(["review"]);
    expect(review.artifactSubmitEvent("review", "revise")).toBe("revise-review");
    expect(review.artifactSubmitEvent("draft", undefined)).toBe("submit-draft");
    expect(review.artifact("notes")).toBeUndefined();
    expect(() => review.role("build")).toThrow('Task workflow "review" has no role "build".');
  });

  test("finds host effects and status events through the definition", () => {
    expect(review.effectEvent("build.completed")).toBe("finish-writing");
    expect(review.effectEvent("task.close")).toBe("shelve");
    expect(review.statusEvent("approval")).toBe("move-approval");
    expect(review.statusEvent("published")).toBeUndefined();
    expect(builtinTaskWorkflow.effectEvent("review.approve")).toBe("human-approve");
    expect(builtinTaskWorkflow.statusEvent("blocked")).toBe("set-status:blocked");
    expect(builtinTaskWorkflow.statusEvent("closed")).toBeUndefined();
  });

  test("decides events with their signal, source role, and guard recovery", () => {
    const drafted = reviewTask({
      status: "writing",
      artifactSummary: { ...review.emptyArtifactSummary(), draft: { present: true } },
    });

    expect(review.decide("finish-writing", drafted)).toEqual({
      kind: "transition",
      from: "writing",
      to: "reviewing",
      cause: { signal: "draftSubmitted", sourceRole: "writer" },
    });
    expect(review.decide("finish-writing", reviewTask({ status: "writing" }))).toEqual({
      kind: "denied",
      status: "writing",
      allowedStatuses: [],
      guardMessage: "Save the draft first",
    });
    expect(review.decide("restart", reviewTask({ status: "published" }))).toEqual({
      kind: "denied",
      status: "published",
      allowedStatuses: ["backlog", "writing", "paused", "reviewing", "approval"],
    });
    expect(review.decide("start-writing", reviewTask({ status: "writing" }))).toEqual({
      kind: "unchanged",
      status: "writing",
    });
  });

  test("selects the launch after an event in the state that the event gives", () => {
    const definition = reviewTaskDefinition();
    const write = definition.steps.find((step) => step.id === "write")!;
    if (write.kind !== "agent") throw new Error("Expected the write step.");
    write.launchActions[0]!.selectWhen = { stateIn: ["writing"] };
    const workflow = createTaskWorkflow(definition, reviewTaskPromptTemplates, reviewTaskRoles);
    const candidates = ["write_revise", "write_start"];

    expect(
      workflow.launchAfterEvent("request-rewrite", reviewTask({ status: "approval" }), candidates),
    ).toBe("write_start");
    expect(() =>
      workflow.launchAfterEvent("request-rewrite", reviewTask({ status: "writing" }), candidates),
    ).toThrow("unavailable");
  });

  test("projects role states and actions from the definition", () => {
    const projection = review.project(reviewTask({ status: "reviewing" }));

    expect(Object.keys(projection.agentWorkflows)).toEqual(["writer", "editor"]);
    expect(projection.agentWorkflows.editor).toEqual({
      required: true,
      canSkip: false,
      available: true,
      completed: false,
    });
    expect(projection.availableActions).toEqual(["request_review", "shelve", "restart"]);
  });

  test("resolves launch actions, automations, and continuations with their roles", () => {
    expect(review.launchAction("write_revise").role).toBe("writer");
    expect(review.automation("startEditor")).toMatchObject({
      launchActionId: "edit_review",
      role: "editor",
    });
    expect(review.roleStartEvent("writer")).toBe("start-writing");
    expect(review.roleStartEvent("editor")).toBeUndefined();
  });

  test("reads state notifications and their default settings", () => {
    expect(review.stateNotification("reviewing")).toEqual({
      kind: "workflow.reviewing",
      status: "Task moved to Reviewing.",
      title: "Ready for review",
      body: "Review the draft.",
      preferredRole: "editor",
      navigation: { type: "agent_studio_task", preferredRole: "editor" },
    });
    expect(review.stateNotification("published", "writer")).toEqual({
      kind: "workflow.published",
      status: "Task moved to Published.",
      title: "Published",
      body: "The task is published.",
      preferredRole: "writer",
      navigation: { type: "kanban_task" },
    });
    expect(review.stateNotification("backlog")).toBeUndefined();
    expect(review.notificationDefaults()).toEqual({
      "workflow.reviewing": { enabled: true, target: "both", sound: "inherit" },
      "workflow.published": { enabled: true, target: "in_app", sound: "none" },
    });
  });

  test("builds prompts from the templates and role tools of the workflow", () => {
    const workflowKey = (promptId: string) =>
      promptOverrideKey({ ownerKind: "workflow", ownerId: "review", promptId });
    const kickoffKey = workflowKey("messages.edit_review");
    const system = review.prompts.systemPrompt({
      role: "editor",
      task: { taskId: "task-1", title: "Essay", issueType: "feature", status: "reviewing" },
    }).prompt;

    expect(system).toContain("You review task task-1 as editor.");
    expect(system).toContain('- odt_read_task({"taskId": string})');
    expect(system).toContain("Allowed workflow codes for odt_set_task_artifact: review.");
    expect(system).toContain("Task task-1: Essay (feature, reviewing)");
    expect(
      review.prompts.kickoffPrompt({ launchActionId: "edit_review", task: { taskId: "task-1" } })
        .prompt,
    ).toBe("Review the draft of task-1.");
    expect(review.prompts.readOnlyRejection({ role: "editor" })).toBe(
      "The editor cannot change files.",
    );
    expect(
      review.prompts.mergeOverrides({
        globalOverrides: { [kickoffKey]: { template: "Global", baseVersion: 1 } },
        repoOverrides: {
          [workflowKey("messages.unknown")]: { template: "Ignored", baseVersion: 1 },
        },
      }),
    ).toEqual({ [kickoffKey]: { template: "Global", baseVersion: 1 } });
  });

  test("lists the agent events of each role and lists them in the role prompt", () => {
    expect(review.agentEvents("writer")).toEqual([
      { id: "finish-writing", description: "Submit the draft for review.", note: "optional" },
      { id: "pause-writing", description: "Pause the writing.", note: "required" },
      { id: "resume-writing", description: "Resume the writing.", note: "optional" },
    ]);
    expect(review.agentEvents("editor")).toEqual([]);
    expect(review.agentEvent("pause-writing")).toEqual({
      id: "pause-writing",
      description: "Pause the writing.",
      note: "required",
      roles: ["writer"],
      effect: "build.blocked",
    });
    expect(review.agentEvent("approve-copy")).toBeUndefined();
    expect(builtinTaskWorkflow.agentEvents("build").map(({ id }) => id)).toEqual([
      "build-blocked",
      "build-resumed",
      "build-completed",
    ]);
    expect(builtinTaskWorkflow.agentEvents("qa")).toEqual([]);

    const writerPrompt = review.prompts.systemPrompt({
      role: "writer",
      task: { taskId: "task-1" },
    }).prompt;
    expect(writerPrompt).toContain(
      [
        "- Workflow events for odt_apply_workflow_event:",
        "  - finish-writing: Submit the draft for review.",
        "  - pause-writing (note required): Pause the writing.",
        "  - resume-writing: Resume the writing.",
      ].join("\n"),
    );
    expect(
      review.prompts.systemPrompt({ role: "editor", task: { taskId: "task-1" } }).prompt,
    ).not.toContain("Workflow events for odt_apply_workflow_event");
  });

  test("rejects an agent event that an agent cannot send", () => {
    const agent = { roles: ["writer"], note: "optional" as const, description: "Send it." };
    expect(
      withChange((definition) => {
        const event = definition.events.find(({ id }) => id === "approve-copy");
        if (event) event.agent = agent;
      }),
    ).toThrow(
      "The event at events[10] has the review.approve effect, so agents cannot send it. Remove events[10].agent, or use no effect or one of status.set, build.blocked, build.resumed, build.completed.",
    );
    expect(
      withChange((definition) => {
        const event = definition.events.find(({ id }) => id === "accept-review");
        if (event) event.agent = { ...agent, roles: ["author"] };
      }),
    ).toThrow('Unknown roles ID "author" at events[');
    expect(
      withChange((definition) => {
        const event = definition.events.find(({ id }) => id === "accept-review");
        if (event) event.agent = { ...agent, roles: ["editor"] };
      }),
    ).toThrow(
      'Task workflow "review" lets role "editor" send events accept-review, but the role has no odt_apply_workflow_event tool. Add the tool to the role, or remove the role from these events.',
    );
  });

  test("supports a subset of the fixed issue types", () => {
    const bugOnly = withChange((definition) => {
      definition.issueTypes = [{ id: "bug", label: "Fix" }];
    })();

    expect(bugOnly.issueTypes).toEqual(["bug"]);
  });

  test("rejects a definition that a task workflow cannot run", () => {
    expect(
      withChange((definition) => {
        definition.issueTypes = [];
      }),
    ).toThrow(
      'Task workflow "review" must support at least one issue type (task, feature, bug) and declare no facts.',
    );
    expect(
      withChange((definition) => {
        definition.facts.push({ id: "priority", type: "enum", values: ["high", "low"] });
      }),
    ).toThrow(
      'Task workflow "review" must support at least one issue type (task, feature, bug) and declare no facts.',
    );
    expect(
      withChange((definition) => {
        const edit = definition.steps.find(({ id }) => id === "edit");
        if (edit?.kind === "agent") edit.roleId = "writer";
      }),
    ).toThrow("gives a role two agent steps");
    expect(
      withChange((definition) => {
        const event = definition.events.find(({ id }) => id === "restart");
        if (event) event.effect = "task.close";
      }),
    ).toThrow('The effect "task.close" is at');
    expect(
      withChange((definition) => {
        const event = definition.events.find(({ id }) => id === "start-writing");
        if (event) event.effect = "status.set";
      }),
    ).toThrow("needs one outcome with when true and a state");
    expect(() =>
      createTaskWorkflow(
        reviewTaskDefinition(),
        reviewTaskPromptTemplates.filter(({ id }) => id !== "messages.write_revise"),
        reviewTaskRoles,
      ),
    ).toThrow(
      'Task workflow "review" has no prompt template "messages.write_revise" for launch action "write_revise".',
    );
    expect(() =>
      createTaskWorkflow(
        reviewTaskDefinition(),
        reviewTaskPromptTemplates.filter(({ id }) => id !== "workflow.tool_rules"),
        reviewTaskRoles,
      ),
    ).toThrow(
      'Task workflow "review" has no prompt template "workflow.tool_rules" for the system prompt.',
    );
    expect(() =>
      createTaskWorkflow(
        reviewTaskDefinition(),
        reviewTaskPromptTemplates.filter(({ id }) => id !== "workflow.read_only_rejection"),
        reviewTaskRoles,
      ),
    ).toThrow(
      'Task workflow "review" has no prompt template "workflow.read_only_rejection" for read-only rejections.',
    );
    expect(() =>
      createTaskWorkflow(
        reviewTaskDefinition(),
        [
          ...reviewTaskPromptTemplates,
          { id: "kickoff.extra", purpose: "kickoff", builtinVersion: 1, template: "Extra" },
        ],
        reviewTaskRoles,
      ),
    ).toThrow(
      'Prompt "kickoff.extra" of task workflow "review" is neither a base workflow prompt nor in the "messages." group. Rename it.',
    );
  });
});
