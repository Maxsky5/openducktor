import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition, WorkflowInput } from "@openducktor/contracts";
import { createWorkflow, WorkflowEvaluationError } from "./evaluate";

const publicationDefinition = (): WorkflowDefinition => ({
  schemaVersion: 1,
  id: "publication",
  revision: 2,
  label: "Publication",
  initialState: "draft",
  facts: [
    { id: "draftReady", type: "boolean" },
    { id: "firstReviewed", type: "boolean" },
    { id: "secondReviewed", type: "boolean" },
    { id: "approved", type: "boolean" },
    { id: "hold", type: "boolean" },
    { id: "edition", type: "number" },
    { id: "owner", type: "string" },
    { id: "channel", type: "enum", values: ["web", "print", null] },
  ],
  roles: [
    { id: "author", label: "Author" },
    { id: "reviewer", label: "Reviewer" },
  ],
  artifacts: [
    { id: "copy", label: "Copy" },
    { id: "first-review", label: "First review" },
    { id: "second-review", label: "Second review" },
    { id: "approval", label: "Approval" },
  ],
  states: [
    { id: "draft", label: "Draft" },
    { id: "first-review", label: "First review" },
    { id: "second-review", label: "Second review" },
    { id: "human-approval", label: "Human approval" },
    { id: "published", label: "Published", terminal: true },
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
      availableWhen: { stateIn: ["draft"] },
      completedWhen: { fact: "draftReady", equals: true },
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
      completedWhen: { fact: "firstReviewed", equals: true },
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
          { fact: "draftReady", equals: true },
        ],
      },
      availableWhen: { stateIn: ["second-review"] },
      completedWhen: { fact: "secondReviewed", equals: true },
    },
    {
      id: "approve",
      label: "Approve publication",
      kind: "human",
      inputs: ["first-review", "second-review"],
      outputs: ["approval"],
      requiredWhen: true,
      availableWhen: { stateIn: ["human-approval"] },
      completedWhen: { fact: "approved", equals: true },
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
      from: ["draft"],
      guards: [{ id: "draft-ready", when: { fact: "draftReady", equals: true } }],
      outcomes: [{ when: true, to: "first-review" }],
    },
    {
      id: "finish-first",
      from: ["first-review"],
      guards: [{ id: "first-reviewed", when: { fact: "firstReviewed", equals: true } }],
      outcomes: [{ when: true, to: "second-review" }],
    },
    {
      id: "finish-second",
      from: ["second-review"],
      guards: [{ id: "second-reviewed", when: { fact: "secondReviewed", equals: true } }],
      outcomes: [{ when: true, to: "human-approval" }],
    },
    {
      id: "publish",
      from: ["human-approval"],
      guards: [
        { id: "first-reviewed", when: { fact: "firstReviewed", equals: true } },
        { id: "second-reviewed", when: { fact: "secondReviewed", equals: true } },
        { id: "approved", when: { fact: "approved", equals: true } },
      ],
      outcomes: [{ when: true, to: "published" }],
    },
  ],
});

const publicationInput = (state: string, facts: WorkflowInput["facts"] = {}): WorkflowInput => ({
  workflowId: "publication",
  definitionRevision: 2,
  state,
  facts,
});

const completedFacts = (): WorkflowInput["facts"] => ({
  draftReady: true,
  firstReviewed: true,
  secondReviewed: true,
  approved: true,
  hold: false,
  edition: 2,
});

describe("generic workflow events", () => {
  test("runs two separate reviews by the same role before human approval and publication", () => {
    const workflow = createWorkflow(publicationDefinition());
    const facts = {
      draftReady: true,
      firstReviewed: false,
      secondReviewed: false,
      approved: false,
      edition: 2,
    };
    let input = publicationInput("draft", facts);
    expect(workflow.decide(input, "submit")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "transition",
      eventId: "submit",
      from: "draft",
      to: "first-review",
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
    input = { ...input, facts: { ...input.facts, firstReviewed: true } };
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
    input = { ...input, facts: { ...input.facts, secondReviewed: true } };
    expect(workflow.decide(input, "finish-second")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "transition",
      eventId: "finish-second",
      from: "second-review",
      to: "human-approval",
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
    input = { ...input, facts: { ...input.facts, approved: true, hold: false } };
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

  test.each([
    { facts: { firstReviewed: false, secondReviewed: false }, guardId: "first-reviewed" },
    { facts: { secondReviewed: false, approved: false }, guardId: "second-reviewed" },
    { facts: { approved: false }, guardId: "approved" },
  ])("names the first failed guard $guardId when steps are available", ({ facts, guardId }) => {
    const definition = publicationDefinition();
    for (const step of definition.steps) step.availableWhen = true;
    const workflow = createWorkflow(definition);
    const input = publicationInput("human-approval", { ...completedFacts(), ...facts });
    expect(workflow.steps(input).every((step) => step.available)).toBe(true);
    expect(workflow.isActionAvailable(input, "publish")).toBe(false);
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

  test("uses source admission before guards and does not evaluate unrelated facts", () => {
    const workflow = createWorkflow(publicationDefinition());
    const input = publicationInput("draft");
    expect(workflow.isActionAvailable(input, "publish")).toBe(false);
    expect(workflow.isEventAvailable(input, "publish")).toBe(false);
    expect(workflow.decide(input, "publish")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "denied",
      eventId: "publish",
      state: "draft",
      reason: "source_state",
    });
    expect(workflow.isActionAvailable(input, "view-copy")).toBe(true);
    expect(workflow.availableActions(publicationInput("draft", { draftReady: false }))).toEqual([
      "view-copy",
    ]);
    expect(() => workflow.steps(input)).toThrow(
      expect.objectContaining({
        code: "missing_fact",
        message: expect.stringContaining('fact "draftReady"'),
      }),
    );
    expect(() => workflow.decide(publicationInput("human-approval"), "publish")).toThrow(
      expect.objectContaining({
        code: "missing_fact",
        message: expect.stringContaining('fact "firstReviewed"'),
      }),
    );
  });

  test("treats an inherited property name as a missing fact", () => {
    const definition = publicationDefinition();
    definition.facts.push({ id: "toString", type: "string" });
    definition.events.push({
      id: "hold-back",
      from: ["draft"],
      guards: [{ id: "not-ready", when: { not: { fact: "toString", equals: "ready" } } }],
      outcomes: [{ when: true, to: "first-review" }],
    });
    const workflow = createWorkflow(definition);
    const missing = expect.objectContaining({
      code: "missing_fact",
      message: expect.stringContaining('fact "toString"'),
    });
    expect(() => workflow.decide(publicationInput("draft"), "hold-back")).toThrow(missing);
    expect(() => workflow.isEventAvailable(publicationInput("draft"), "hold-back")).toThrow(
      missing,
    );
  });

  test("blocks transitions out of terminal states and admits listed repeats", () => {
    const definition = publicationDefinition();
    definition.events.push({
      id: "record",
      from: ["human-approval", "published"],
      guards: [{ id: "approved", when: { fact: "approved", equals: true } }],
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
    const published = (facts: WorkflowInput["facts"]) => publicationInput("published", facts);
    expect(workflow.decide(published({ approved: true, hold: false }), "record")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "unchanged",
      eventId: "record",
      state: "published",
    });
    expect(workflow.decide(published({ approved: true, hold: true }), "record")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "denied",
      eventId: "record",
      state: "published",
      reason: "terminal_state",
    });
    expect(workflow.decide(published({ approved: false }), "record")).toMatchObject({
      kind: "denied",
      reason: "guard",
      guardId: "approved",
    });
    expect(workflow.decide(published({}), "publish")).toMatchObject({
      kind: "denied",
      reason: "source_state",
    });
    expect(workflow.isEventAvailable(published({ approved: true }), "record")).toBe(true);
    expect(workflow.availableActions(published({ approved: true, hold: false }))).toEqual([
      "view-copy",
    ]);
    expect(workflow.steps(published(completedFacts()))[3]).toEqual({
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
    const input = publicationInput("human-approval", { ...completedFacts(), hold: true });
    expect(workflow.isEventAvailable(input, "publish")).toBe(true);
    expect(workflow.decide(input, "publish").kind).toBe("transition");
    expect(workflow.isActionAvailable(input, "publish")).toBe(false);
    expect(workflow.availableActions(input)).toEqual(["view-copy"]);
  });

  test("compiles an extra condition once and checks input on each call", () => {
    const workflow = createWorkflow(publicationDefinition());
    const ready = workflow.condition({
      all: [{ stateIn: ["draft"] }, { fact: "draftReady", equals: true }],
    });
    expect(ready(publicationInput("draft", { draftReady: true }))).toBe(true);
    expect(ready(publicationInput("first-review", { draftReady: true }))).toBe(false);
    expect(() => ready(publicationInput("draft"))).toThrow(
      expect.objectContaining({ code: "missing_fact" }),
    );
    expect(() => ready({ ...publicationInput("draft"), definitionRevision: 1 })).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );
    for (const condition of [
      { stateIn: ["missing"] },
      { fact: "missing", equals: true },
      { fact: "edition", equals: "2" },
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
    const event = definition.events[3]!;
    event.guards = [];
    event.outcomes = [
      { when: { fact: "hold", equals: true }, to: null },
      { when: { fact: "approved", equals: false }, to: "human-approval" },
      { when: true, to: "published" },
    ];
    const workflow = createWorkflow(definition);
    expect(workflow.isEventAvailable(publicationInput("human-approval"), "publish")).toBe(true);
    expect(
      workflow.isActionAvailable(publicationInput("human-approval", { hold: false }), "publish"),
    ).toBe(true);
    expect(workflow.decide(publicationInput("human-approval", { hold: true }), "publish")).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "unchanged",
      eventId: "publish",
      state: "human-approval",
    });
    expect(
      workflow.decide(
        publicationInput("human-approval", { hold: false, approved: false }),
        "publish",
      ),
    ).toEqual({
      workflowId: "publication",
      definitionRevision: 2,
      kind: "unchanged",
      eventId: "publish",
      state: "human-approval",
    });
    expect(
      workflow.decide(
        publicationInput("human-approval", { hold: false, approved: true }),
        "publish",
      ),
    ).toEqual({
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
    const input = publicationInput("draft", { draftReady: true });
    expect(workflow.isActionAvailable(input, "submit")).toBe(true);
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
        availableWhen: { all: [false, { fact: "approved", equals: true }] },
      },
      {
        id: "any",
        label: "Any",
        kind: "view",
        availableWhen: { any: [true, { fact: "approved", equals: true }] },
      },
      {
        id: "null",
        label: "Null",
        kind: "view",
        availableWhen: { not: { not: { fact: "channel", equals: null } } },
      },
    ];
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
    source.events[3]!.guards.push({ id: "never", when: false });
    source.steps[1]!.label = "Changed";
    source.steps[1]!.inputs.push("approval");
    const input = publicationInput("human-approval", completedFacts());
    const steps = workflow.steps(input);
    expect(steps[1]!.label).toBe("Review the draft");
    expect(steps[1]!.inputs).toEqual(["copy"]);
    expect(workflow.availableActions(input)).toContain("publish");
    expect(() => Object.assign(workflow.definition.events[3]!, { guards: [] })).toThrow();
    expect(() => Object.assign(workflow.definition.facts[7]!, { id: "changed" })).toThrow();
    expect(Object.isFrozen(steps[1]!.inputs)).toBe(true);
  });
});

describe("workflow definition validation", () => {
  const referenceCases: Array<{
    name: string;
    change: (definition: WorkflowDefinition) => void;
    path: string;
  }> = [
    {
      name: "initial state",
      change: (definition) => {
        definition.initialState = "missing";
      },
      path: "initialState",
    },
    {
      name: "agent role",
      change: (definition) => {
        definition.roles = [];
      },
      path: "steps[0].roleId",
    },
    {
      name: "input artifact",
      change: (definition) => {
        definition.steps[1]!.inputs = ["missing"];
      },
      path: "steps[1].inputs[0]",
    },
    {
      name: "output artifact",
      change: (definition) => {
        definition.steps[0]!.outputs = ["missing"];
      },
      path: "steps[0].outputs[0]",
    },
    {
      name: "action step",
      change: (definition) => {
        definition.actions[0]!.stepId = "missing";
      },
      path: "actions[0].stepId",
    },
    {
      name: "action event",
      change: (definition) => {
        definition.actions[0] = {
          id: "submit",
          label: "Submit",
          kind: "event",
          eventId: "missing",
          availableWhen: true,
        };
      },
      path: "actions[0].eventId",
    },
    {
      name: "step requirement state",
      change: (definition) => {
        definition.steps[0]!.requiredWhen = { stateIn: ["missing"] };
      },
      path: "steps[0].requiredWhen.stateIn[0]",
    },
    {
      name: "step availability state",
      change: (definition) => {
        definition.steps[0]!.availableWhen = { stateIn: ["missing"] };
      },
      path: "steps[0].availableWhen.stateIn[0]",
    },
    {
      name: "step completion state",
      change: (definition) => {
        definition.steps[0]!.completedWhen = { stateIn: ["missing"] };
      },
      path: "steps[0].completedWhen.stateIn[0]",
    },
    {
      name: "event source",
      change: (definition) => {
        definition.events[0]!.from = ["missing"];
      },
      path: "events[0].from[0]",
    },
    {
      name: "event target",
      change: (definition) => {
        definition.events[0]!.outcomes[0]!.to = "missing";
      },
      path: "events[0].outcomes[0].to",
    },
    {
      name: "event guard state",
      change: (definition) => {
        definition.events[0]!.guards = [{ id: "ready", when: { stateIn: ["missing"] } }];
      },
      path: "events[0].guards[0].when.stateIn[0]",
    },
    {
      name: "event action availability state",
      change: (definition) => {
        definition.actions[0]!.availableWhen = { stateIn: ["missing"] };
      },
      path: "actions[0].availableWhen.stateIn[0]",
    },
    {
      name: "event outcome state",
      change: (definition) => {
        definition.events[0]!.outcomes[0]!.when = { stateIn: ["missing"] };
      },
      path: "events[0].outcomes[0].when.stateIn[0]",
    },
    {
      name: "unused view condition state",
      change: (definition) => {
        definition.actions[4] = {
          id: "view-copy",
          label: "View copy",
          kind: "view",
          availableWhen: { any: [true, { not: { all: [{ stateIn: ["missing"] }] } }] },
        };
      },
      path: "actions[4].availableWhen.any[1].not.all[0].stateIn[0]",
    },
  ];
  test.each(referenceCases)(
    "rejects an unknown $name reference before evaluation",
    ({ change, path }) => {
      const definition = publicationDefinition();
      change(definition);
      expect(() => createWorkflow(definition)).toThrow(
        expect.objectContaining({
          code: "invalid_definition",
          message: expect.stringContaining(path),
        }),
      );
    },
  );

  test.each(["facts", "roles", "artifacts", "states", "steps", "actions", "events"] as const)(
    "rejects duplicate IDs in %s",
    (collection) => {
      const definition = publicationDefinition();
      const items: Array<{ id: string }> = definition[collection];
      items.push(items[0]!);
      expect(() => createWorkflow(definition)).toThrow(
        expect.objectContaining({
          code: "invalid_definition",
          message: expect.stringContaining(`in ${collection}`),
        }),
      );
    },
  );

  test("rejects duplicate guard IDs in one event", () => {
    const definition = publicationDefinition();
    definition.events[3]!.guards.push({ id: "approved", when: true });
    expect(() => createWorkflow(definition)).toThrow(
      expect.objectContaining({
        code: "invalid_definition",
        message: expect.stringContaining('Duplicate ID "approved" in events[3].guards'),
      }),
    );
  });

  test.each([
    { name: "undeclared fact", condition: { fact: "missing", equals: true }, path: ".fact" },
    {
      name: "boolean comparison",
      condition: { fact: "approved", equals: "true" },
      path: ".equals",
    },
    { name: "number comparison", condition: { fact: "edition", equals: "2" }, path: ".equals" },
    { name: "string comparison", condition: { fact: "owner", equals: null }, path: ".equals" },
    { name: "enum comparison", condition: { fact: "channel", equals: "radio" }, path: ".equals" },
  ])("validates an unreachable $name", ({ condition, path }) => {
    const definition = publicationDefinition();
    definition.events[0]!.outcomes = [
      { when: true, to: "first-review" },
      { when: { all: [false, condition] }, to: null },
    ];
    expect(() => createWorkflow(definition)).toThrow(
      expect.objectContaining({
        code: "invalid_definition",
        message: expect.stringContaining(`events[0].outcomes[1].when.all[1]${path}`),
      }),
    );
  });

  test.each([
    {
      location: "step requirement",
      change: (definition: WorkflowDefinition) => {
        definition.steps[0]!.requiredWhen = { fact: "missing", equals: true };
      },
    },
    {
      location: "step availability",
      change: (definition: WorkflowDefinition) => {
        definition.steps[0]!.availableWhen = { fact: "missing", equals: true };
      },
    },
    {
      location: "step completion",
      change: (definition: WorkflowDefinition) => {
        definition.steps[0]!.completedWhen = { fact: "missing", equals: true };
      },
    },
    {
      location: "view action",
      change: (definition: WorkflowDefinition) => {
        definition.actions[4] = {
          id: "view-copy",
          label: "View copy",
          kind: "view",
          availableWhen: { fact: "missing", equals: true },
        };
      },
    },
    {
      location: "event guard",
      change: (definition: WorkflowDefinition) => {
        definition.events[0]!.guards = [{ id: "ready", when: { fact: "missing", equals: true } }];
      },
    },
  ])("checks fact references in each $location", ({ change }) => {
    const definition = publicationDefinition();
    change(definition);
    expect(() => createWorkflow(definition)).toThrow(
      expect.objectContaining({
        code: "invalid_definition",
        message: expect.stringContaining('Unknown fact "missing"'),
      }),
    );
  });

  test("wraps malformed definitions in an actionable workflow error", () => {
    const definition = publicationDefinition();
    definition.revision = 0;
    expect(() => createWorkflow(definition)).toThrow(
      expect.objectContaining({
        code: "invalid_definition",
        message: expect.stringContaining("revision"),
      }),
    );
  });
});

describe("workflow input validation", () => {
  test.each([
    { name: "workflow ID", change: { workflowId: "other" } },
    { name: "definition revision", change: { definitionRevision: 1 } },
  ])("checks $name on every query", ({ change }) => {
    const workflow = createWorkflow(publicationDefinition());
    const input = { ...publicationInput("draft"), ...change };
    for (const query of [
      () => workflow.condition(true)(input),
      () => workflow.steps(input),
      () => workflow.availableActions(input),
      () => workflow.isActionAvailable(input, "view-copy"),
      () => workflow.isEventAvailable(input, "publish"),
      () => workflow.decide(input, "publish"),
    ])
      expect(query).toThrow(
        expect.objectContaining({
          code: "invalid_input",
          message: expect.stringContaining('workflowId "publication" and definitionRevision 2'),
        }),
      );
  });

  test.each([
    { name: "undeclared", facts: { unknown: true }, path: "facts.unknown" },
    { name: "boolean", facts: { approved: "true" }, path: "facts.approved" },
    { name: "number", facts: { edition: "2" }, path: "facts.edition" },
    { name: "string", facts: { owner: 2 }, path: "facts.owner" },
    { name: "boolean string", facts: { owner: true }, path: "facts.owner" },
    { name: "enum", facts: { channel: "radio" }, path: "facts.channel" },
    {
      name: "non-finite number",
      facts: { edition: Number.POSITIVE_INFINITY },
      path: "facts.edition",
    },
  ])("rejects a supplied $name fact even when the query does not use it", ({ facts, path }) => {
    const workflow = createWorkflow(publicationDefinition());
    expect(() =>
      workflow.isActionAvailable(publicationInput("published", facts), "view-copy"),
    ).toThrow(
      expect.objectContaining({ code: "invalid_input", message: expect.stringContaining(path) }),
    );
  });

  test("reports unknown state, action, and event IDs", () => {
    const workflow = createWorkflow(publicationDefinition());
    expect(() => workflow.steps(publicationInput("missing"))).toThrow(
      expect.objectContaining({ code: "unknown_state" }),
    );
    expect(() => workflow.isActionAvailable(publicationInput("draft"), "missing")).toThrow(
      expect.objectContaining({ code: "unknown_action" }),
    );
    for (const query of [
      () => workflow.isEventAvailable(publicationInput("draft"), "missing"),
      () => workflow.decide(publicationInput("draft"), "missing"),
    ]) {
      try {
        query();
        throw new Error("Expected an unknown event error.");
      } catch (error) {
        expect(error).toBeInstanceOf(WorkflowEvaluationError);
        if (!(error instanceof WorkflowEvaluationError)) throw error;
        expect(error.code).toBe("unknown_event");
      }
    }
  });
});
