import { describe, expect, test } from "bun:test";
import type { WorkflowInput } from "@openducktor/contracts";
import {
  publicationDefinition,
  publicationInput,
  noArtifacts,
  completedArtifacts,
} from "../test-support/publication-workflow";
import { createWorkflow } from "./evaluate";

describe("generic workflow events", () => {
  test("runs two separate reviews by the same role before human approval and publication", () => {
    const workflow = createWorkflow(publicationDefinition());
    let input = publicationInput(
      "draft",
      { edition: 2 },
      { ...noArtifacts(), copy: { present: true } },
    );
    expect(workflow.decide(input, "submit")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "transition",
      eventId: "submit",
      from: "draft",
      to: "first-review",
      signal: "copySubmitted",
      sourceRole: "author",
    });
    input = { ...input, state: "first-review" };
    expect(workflow.decide(input, "finish-first")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "denied",
      eventId: "finish-first",
      state: "first-review",
      reason: "guard",
      guardId: "first-reviewed",
    });
    input = {
      ...input,
      artifacts: { ...input.artifacts, "first-review": { present: true, verdict: "approved" } },
    };
    expect(workflow.decide(input, "finish-first")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "transition",
      eventId: "finish-first",
      from: "first-review",
      to: "second-review",
    });
    input = { ...input, state: "second-review" };
    const steps = workflow.steps(input);
    expect(steps.map(({ id }) => id)).toEqual([
      "write",
      "review-first",
      "review-second",
      "approve",
    ]);
    expect(
      steps
        .filter((step) => step.kind === "agent" && step.roleId === "reviewer")
        .map(({ id, available, completed }) => ({ id, available, completed })),
    ).toEqual([
      { id: "review-first", available: false, completed: true },
      { id: "review-second", available: true, completed: false },
    ]);
    expect(steps[2]!.inputs).toEqual(["copy", "first-review"]);
    expect(steps[2]!.outputs).toEqual(["second-review"]);
    expect(workflow.decide(input, "finish-second").kind).toBe("denied");
    input = {
      ...input,
      artifacts: { ...input.artifacts, "second-review": { present: true, verdict: "approved" } },
    };
    expect(workflow.decide(input, "finish-second")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "transition",
      eventId: "finish-second",
      from: "second-review",
      to: "human-approval",
      signal: "readyForApproval",
      sourceRole: "reviewer",
    });
    input = { ...input, state: "human-approval" };
    expect(workflow.decide(input, "publish")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "denied",
      eventId: "publish",
      state: "human-approval",
      reason: "guard",
      guardId: "approved",
    });
    input = {
      ...input,
      facts: { ...input.facts, hold: false },
      artifacts: { ...input.artifacts, approval: { present: true } },
    };
    expect(workflow.decide(input, "publish")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "transition",
      eventId: "publish",
      from: "human-approval",
      to: "published",
    });
    expect(workflow.availableActions(input)).toEqual(["publish", "view-copy"]);
  });

  test("sends the signal of a failing verdict event and omits signals on unchanged decisions", () => {
    const definition = publicationDefinition();
    definition.events[3]!.outcomes = [
      { when: { stateIn: ["second-review"] }, to: null, signal: "changesRequested" },
      { when: true, to: "draft", signal: "changesRequested" },
    ];
    const workflow = createWorkflow(definition);
    expect(workflow.decide(publicationInput("first-review"), "return-draft")).toMatchObject({
      kind: "transition",
      to: "draft",
      signal: "changesRequested",
    });
    expect(workflow.decide(publicationInput("second-review"), "return-draft")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "unchanged",
      eventId: "return-draft",
      state: "second-review",
    });
  });

  test.each([
    {
      artifacts: { "first-review": { present: false }, "second-review": { present: false } },
      guardId: "first-reviewed",
    },
    {
      artifacts: {
        "second-review": { present: true, verdict: "changes" },
        approval: { present: false },
      },
      guardId: "second-reviewed",
    },
    { artifacts: { approval: { present: false } }, guardId: "approved" },
  ])("names the first failed guard $guardId when steps are available", ({ artifacts, guardId }) => {
    const definition = publicationDefinition();
    for (const step of definition.steps) step.availableWhen = true;
    const workflow = createWorkflow(definition);
    const input = publicationInput(
      "human-approval",
      { hold: false, edition: 2 },
      { ...completedArtifacts(), ...artifacts },
    );
    expect(workflow.steps(input).every((step) => step.available)).toBe(true);
    expect(workflow.availableActions(input).includes("publish")).toBe(false);
    expect(workflow.isEventAvailable(input, "publish")).toBe(false);
    expect(workflow.decide(input, "publish")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "denied",
      eventId: "publish",
      state: "human-approval",
      reason: "guard",
      guardId,
    });
  });

  test("uses source admission before guards and does not evaluate unrelated artifacts", () => {
    const workflow = createWorkflow(publicationDefinition());
    const input = publicationInput("draft");
    expect(workflow.isEventAvailable(input, "publish")).toBe(false);
    expect(workflow.decide(input, "publish")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "denied",
      eventId: "publish",
      state: "draft",
      reason: "source_state",
    });
    expect(
      workflow.availableActions(publicationInput("draft", {}, { copy: { present: false } })),
    ).toEqual(["start-writing", "view-copy"]);
    expect(() => workflow.steps(input)).toThrow(
      expect.objectContaining({
        code: "missing_artifact",
        message: expect.stringContaining('artifact "copy"'),
      }),
    );
    expect(() => workflow.decide(publicationInput("human-approval"), "publish")).toThrow(
      expect.objectContaining({
        code: "missing_artifact",
        message: expect.stringContaining('artifact "first-review"'),
      }),
    );
  });

  test("treats an inherited property name as a missing fact or artifact", () => {
    const definition = publicationDefinition();
    definition.facts.push({ id: "toString", type: "string" });
    definition.artifacts.push({ id: "valueOf", label: "Value", kind: "document" });
    definition.events.push(
      {
        id: "hold-back",
        from: ["draft"],
        guards: [{ id: "not-ready", when: { not: { fact: "toString", equals: "ready" } } }],
        outcomes: [{ when: true, to: "first-review" }],
      },
      {
        id: "value-back",
        from: ["draft"],
        guards: [{ id: "value", when: { artifact: "valueOf", present: true } }],
        outcomes: [{ when: true, to: "first-review" }],
      },
    );
    const workflow = createWorkflow(definition);
    expect(() => workflow.decide(publicationInput("draft"), "hold-back")).toThrow(
      expect.objectContaining({
        code: "missing_fact",
        message: expect.stringContaining("toString"),
      }),
    );
    expect(() => workflow.isEventAvailable(publicationInput("draft"), "value-back")).toThrow(
      expect.objectContaining({
        code: "missing_artifact",
        message: expect.stringContaining("valueOf"),
      }),
    );
  });

  test("blocks transitions out of terminal states and admits listed repeats", () => {
    const definition = publicationDefinition();
    definition.events.push({
      id: "record",
      from: ["human-approval", "published"],
      guards: [{ id: "approved", when: { artifact: "approval", present: true } }],
      outcomes: [
        { when: { fact: "hold", equals: true }, to: "draft" },
        { when: true, to: "published" },
      ],
    });
    definition.actions.push({
      id: "record",
      label: "Record",
      kind: "event",
      eventId: "record",
      availableWhen: { stateIn: ["human-approval"] },
    });
    const workflow = createWorkflow(definition);
    const published = (facts: WorkflowInput["facts"], approved = true) =>
      publicationInput("published", facts, { approval: { present: approved } });
    expect(workflow.decide(published({ hold: false }), "record")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "unchanged",
      eventId: "record",
      state: "published",
    });
    expect(workflow.decide(published({ hold: true }), "record")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "denied",
      eventId: "record",
      state: "published",
      reason: "terminal_state",
    });
    expect(workflow.decide(published({}, false), "record")).toMatchObject({
      kind: "denied",
      reason: "guard",
      guardId: "approved",
    });
    expect(workflow.decide(published({}), "publish")).toMatchObject({
      kind: "denied",
      reason: "source_state",
    });
    expect(workflow.isEventAvailable(published({}), "record")).toBe(true);
    expect(workflow.availableActions(published({ hold: false }))).toEqual(["view-copy"]);
    expect(
      workflow.steps(publicationInput("published", { edition: 2 }, completedArtifacts()))[3],
    ).toEqual({
      id: "approve",
      label: "Approve publication",
      kind: "human",
      inputs: ["first-review", "second-review"],
      outputs: ["approval"],
      required: true,
      available: false,
      completed: true,
    });
  });

  test("narrows event actions without changing event admission", () => {
    const workflow = createWorkflow(publicationDefinition());
    const input = publicationInput("human-approval", { hold: true }, completedArtifacts());
    expect(workflow.isEventAvailable(input, "publish")).toBe(true);
    expect(workflow.decide(input, "publish").kind).toBe("transition");
    expect(workflow.availableActions(input).includes("publish")).toBe(false);
    expect(workflow.availableActions(input)).toEqual(["view-copy"]);
  });

  test("compiles an extra condition once and checks input on each call", () => {
    const workflow = createWorkflow(publicationDefinition());
    const ready = workflow.condition({
      all: [{ stateIn: ["draft"] }, { artifact: "copy", present: true }],
    });
    expect(ready(publicationInput("draft", {}, { copy: { present: true } }))).toBe(true);
    expect(ready(publicationInput("first-review", {}, { copy: { present: true } }))).toBe(false);
    expect(() => ready(publicationInput("draft"))).toThrow(
      expect.objectContaining({ code: "missing_artifact" }),
    );
    expect(() => ready({ ...publicationInput("draft"), definitionRevision: 1 })).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );
    for (const condition of [
      { stateIn: ["missing"] },
      { fact: "missing", equals: true },
      { fact: "edition", equals: "2" },
      { artifact: "missing", present: true },
      { artifact: "copy", verdict: "approved" },
      { artifact: "first-review", verdict: "missing" },
      { any: [{ unknown: true }] },
    ]) {
      // SAFETY: These malformed conditions check runtime validation of untyped data.
      expect(() => workflow.condition(condition as never)).toThrow(
        expect.objectContaining({ code: "invalid_condition" }),
      );
    }
  });

  test("uses the first matching outcome and supports null and same-state outcomes", () => {
    const definition = publicationDefinition();
    const event = definition.events[4]!;
    event.guards = [];
    event.outcomes = [
      { when: { fact: "hold", equals: true }, to: null },
      { when: { artifact: "approval", present: false }, to: "human-approval" },
      { when: true, to: "published" },
    ];
    const workflow = createWorkflow(definition);
    const input = (hold: boolean, approved = false) =>
      publicationInput("human-approval", { hold }, { approval: { present: approved } });
    expect(workflow.isEventAvailable(publicationInput("human-approval"), "publish")).toBe(true);
    expect(workflow.availableActions(input(false)).includes("publish")).toBe(true);
    expect(workflow.decide(input(true), "publish")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "unchanged",
      eventId: "publish",
      state: "human-approval",
    });
    expect(workflow.decide(input(false), "publish")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "unchanged",
      eventId: "publish",
      state: "human-approval",
    });
    expect(workflow.decide(input(false, true), "publish")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "transition",
      eventId: "publish",
      from: "human-approval",
      to: "published",
    });
  });

  test("reports an admitted event with no matching outcome", () => {
    const definition = publicationDefinition();
    definition.events[0]!.outcomes = [{ when: false, to: "first-review" }];
    const workflow = createWorkflow(definition);
    const input = publicationInput("draft", {}, { copy: { present: true } });
    expect(workflow.availableActions(input).includes("submit")).toBe(true);
    expect(() => workflow.decide(input, "submit")).toThrow(
      expect.objectContaining({
        code: "missing_event_outcome",
        message: expect.stringContaining('event "submit"'),
      }),
    );
  });

  test("short-circuits recursive conditions and compares nullable enum values without coercion", () => {
    const definition = publicationDefinition();
    definition.actions = [
      {
        id: "all",
        label: "All",
        kind: "view",
        availableWhen: { all: [false, { artifact: "approval", present: true }] },
      },
      {
        id: "any",
        label: "Any",
        kind: "view",
        availableWhen: { any: [true, { artifact: "approval", present: true }] },
      },
      {
        id: "null",
        label: "Null",
        kind: "view",
        availableWhen: { not: { not: { fact: "channel", equals: null } } },
      },
    ];
    definition.actionOrder = [];
    definition.actionPriority = [];
    const workflow = createWorkflow(definition);
    expect(workflow.availableActions(publicationInput("draft", { channel: null }))).toEqual([
      "any",
      "null",
    ]);
    expect(workflow.availableActions(publicationInput("draft", { channel: "web" }))).toEqual([
      "any",
    ]);
    expect(() => workflow.availableActions(publicationInput("draft"))).toThrow(
      expect.objectContaining({
        code: "missing_fact",
        message: expect.stringContaining('fact "channel"'),
      }),
    );
  });

  test("uses a private frozen definition snapshot and readonly projection arrays", () => {
    const source = publicationDefinition();
    const workflow = createWorkflow(source);
    source.events[4]!.guards.push({ id: "never", when: false });
    source.steps[1]!.label = "Changed";
    source.steps[1]!.inputs.push("approval");
    const input = publicationInput(
      "human-approval",
      { edition: 2, hold: false },
      completedArtifacts(),
    );
    const steps = workflow.steps(input);
    expect(steps[1]!.label).toBe("Review the draft");
    expect(steps[1]!.inputs).toEqual(["copy"]);
    expect(workflow.availableActions(input)).toContain("publish");
    expect(() => Object.assign(workflow.definition.events[4]!, { guards: [] })).toThrow();
    expect(() => Object.assign(workflow.definition.facts[3]!, { id: "changed" })).toThrow();
    expect(Object.isFrozen(steps[1]!.inputs)).toBe(true);
  });
});
