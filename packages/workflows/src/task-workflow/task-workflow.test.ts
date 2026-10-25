import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "@openducktor/contracts";
import {
  createReviewTaskWorkflow,
  reviewTaskDefinition,
  reviewTaskPromptTemplates,
} from "../../test-support/review-task-workflow";
import { builtinTaskWorkflow } from "../builtin/task-workflow";
import type { TaskFacts } from "./task-input";
import { createTaskWorkflow } from "./task-workflow";

const review = createReviewTaskWorkflow();

const reviewTask = (overrides: Partial<TaskFacts> = {}): TaskFacts => ({
  id: "task-1",
  status: "backlog",
  issueType: "article",
  artifactSummary: review.emptyArtifactSummary(),
  ...overrides,
});

const withChange = (change: (definition: WorkflowDefinition) => void) => {
  const definition = reviewTaskDefinition();
  change(definition);
  return () => createTaskWorkflow(definition, reviewTaskPromptTemplates);
};

describe("createTaskWorkflow", () => {
  test("reads states, roles, artifacts, and issue types from the definition", () => {
    expect(review.issueTypes).toEqual(["article", "fix"]);
    expect(review.initialState).toBe("backlog");
    expect(review.terminalStates).toEqual(["published", "shelved"]);
    expect(review.isTerminalState("shelved")).toBe(true);
    expect(review.isTerminalState("approval")).toBe(false);
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
      preferredRole: "editor",
      navigation: { type: "agent_studio_task", preferredRole: "editor" },
    });
    expect(review.stateNotification("published", "writer")).toEqual({
      kind: "workflow.published",
      status: "Task moved to Published.",
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
    const system = review.prompts.systemPrompt({
      role: "editor",
      task: { taskId: "task-1", title: "Essay", issueType: "article", status: "reviewing" },
    }).prompt;

    expect(system).toContain("You review task task-1 as editor.");
    expect(system).toContain('- odt_read_task({"taskId": string})');
    expect(system).toContain("Allowed workflow codes for odt_set_task_artifact: review.");
    expect(system).toContain("Task task-1: Essay (article, reviewing)");
    expect(
      review.prompts.kickoffPrompt({ launchActionId: "edit_review", task: { taskId: "task-1" } })
        .prompt,
    ).toBe("Review the draft of task-1.");
    expect(review.prompts.readOnlyRejection({ role: "editor" })).toBe(
      "The editor cannot change files.",
    );
    expect(
      review.prompts.mergeOverrides({
        globalOverrides: { "kickoff.edit_review": { template: "Global", baseVersion: 1 } },
        repoOverrides: { "kickoff.unknown": { template: "Ignored", baseVersion: 1 } },
      }),
    ).toEqual({ "kickoff.edit_review": { template: "Global", baseVersion: 1 } });
  });

  test("rejects a definition that a task workflow cannot run", () => {
    expect(
      withChange((definition) => {
        definition.facts = [];
      }),
    ).toThrow('Task workflow "review" must declare one fact: the issueType enum');
    expect(
      withChange((definition) => {
        definition.facts.push({ id: "priority", type: "enum", values: ["high", "low"] });
      }),
    ).toThrow('Task workflow "review" must declare one fact: the issueType enum');
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
        reviewTaskPromptTemplates.filter(({ id }) => id !== "kickoff.write_revise"),
      ),
    ).toThrow(
      'Task workflow "review" has no prompt template "kickoff.write_revise" for launch action "write_revise".',
    );
  });
});
