import { describe, expect, test } from "bun:test";
import {
  workflowConditionSchema,
  workflowFactDefinitionSchema,
} from "./workflow-condition-schemas";
import { type WorkflowDefinition, workflowDefinitionSchema } from "./workflow-definition-schemas";

const createDefinition = (): WorkflowDefinition => ({
  schemaVersion: 1,
  id: "release-review",
  revision: 2,
  label: "Release review",
  facts: [
    { id: "reviewRequired", type: "boolean" },
    { id: "frozen", type: "boolean" },
    { id: "reviewedAt", type: "enum", values: [null, "recorded"] },
    { id: "attempt", type: "number" },
    { id: "decision", type: "enum", values: ["approved", "rejected"] },
    { id: "comment", type: "string" },
  ],
  roles: [{ id: "reviewer", label: "Reviewer" }],
  artifacts: [{ id: "release-notes", label: "Release notes" }],
  states: [
    { id: "draft", label: "Draft", title: "Release draft" },
    { id: "released", label: "Released", terminal: true },
  ],
  initialState: "draft",
  steps: [
    {
      id: "review-notes",
      label: "Review notes",
      kind: "agent",
      roleId: "reviewer",
      inputs: ["release-notes"],
      outputs: [],
      requiredWhen: { fact: "reviewRequired", equals: true },
      availableWhen: { all: [{ stateIn: ["draft"] }, { not: { fact: "frozen", equals: true } }] },
      completedWhen: { fact: "reviewedAt", equals: null },
    },
    {
      id: "approve-release",
      label: "Approve release",
      kind: "human",
      inputs: [],
      outputs: ["release-notes"],
      requiredWhen: true,
      availableWhen: { any: [{ fact: "attempt", equals: 2 }, false] },
      completedWhen: { fact: "decision", equals: "approved" },
    },
  ],
  actions: [
    {
      id: "approve",
      label: "Approve",
      kind: "event",
      stepId: "approve-release",
      eventId: "save-decision",
      availableWhen: { not: { fact: "frozen", equals: true } },
    },
    { id: "view-notes", label: "View notes", kind: "view", availableWhen: true },
  ],
  events: [
    {
      id: "save-decision",
      from: ["draft"],
      guards: [{ id: "not-frozen", when: { not: { fact: "frozen", equals: true } } }],
      outcomes: [
        { when: { fact: "decision", equals: "approved" }, to: "released" },
        { when: true, to: null },
      ],
    },
  ],
});

describe("workflow definition schemas", () => {
  test("preserves a JSON definition with custom roles, artifacts, states, and both step kinds", () => {
    const definition = createDefinition();

    expect(workflowDefinitionSchema.parse(JSON.parse(JSON.stringify(definition)))).toEqual(
      definition,
    );
  });

  test("rejects invalid step kinds and agent fields on human steps", () => {
    const definition = createDefinition();
    const agentStep = definition.steps[0];
    const humanStep = definition.steps[1];

    expect(
      workflowDefinitionSchema.safeParse({
        ...definition,
        steps: [{ ...agentStep, kind: "script" }],
      }).success,
    ).toBe(false);
    expect(
      workflowDefinitionSchema.safeParse({
        ...definition,
        steps: [{ ...humanStep, roleId: "reviewer" }],
      }).success,
    ).toBe(false);
  });

  test("rejects blank identifiers without changing supplied identifiers", () => {
    const definition = createDefinition();
    for (const identifier of ["", " ", "\t\n"]) {
      for (const invalidDefinition of [
        { ...definition, id: identifier },
        { ...definition, initialState: identifier },
        { ...definition, facts: [{ id: identifier, type: "boolean" }] },
        {
          ...definition,
          actions: [
            {
              id: "view-notes",
              kind: "view",
              label: "View notes",
              availableWhen: { fact: identifier, equals: true },
            },
          ],
        },
      ]) {
        expect(workflowDefinitionSchema.safeParse(invalidDefinition).success).toBe(false);
      }
    }
    expect(workflowDefinitionSchema.parse({ ...definition, id: " release-review " }).id).toBe(
      " release-review ",
    );
  });

  test("requires the schema version and a positive definition revision", () => {
    const definition = createDefinition();
    for (const fields of [
      { schemaVersion: undefined },
      { schemaVersion: 2 },
      { revision: undefined },
      { revision: 0 },
      { revision: -1 },
      { revision: 1.5 },
      { version: 2 },
      { transitions: [] },
      { operations: [] },
    ]) {
      expect(workflowDefinitionSchema.safeParse({ ...definition, ...fields }).success).toBe(false);
    }
  });

  test("keeps event admission on named guards and action availability on every action", () => {
    const definition = createDefinition();
    const event = definition.events[0];
    expect(
      workflowDefinitionSchema.parse({ ...definition, events: [{ ...event, guards: [] }] }).events,
    ).toEqual([{ ...event, guards: [] }]);
    for (const invalidDefinition of [
      { ...definition, events: [{ ...event, from: [] }] },
      { ...definition, events: [{ ...event, outcomes: [] }] },
      { ...definition, events: [{ ...event, guards: undefined }] },
      { ...definition, events: [{ ...event, guard: true }] },
      { ...definition, events: [{ ...event, guards: [{ when: true }] }] },
      { ...definition, events: [{ ...event, guards: [{ id: " ", when: true }] }] },
      { ...definition, events: [{ ...event, guards: [{ id: "open", when: true, label: "" }] }] },
      {
        ...definition,
        events: [{ ...event, outcomes: [{ when: true, destination: "released" }] }],
      },
      { ...definition, actions: [{ ...definition.actions[0], availableWhen: undefined }] },
      { ...definition, actions: [{ ...definition.actions[1], availableWhen: undefined }] },
      { ...definition, actions: [{ ...definition.actions[0], guard: true }] },
      { ...definition, actions: [{ ...definition.actions[0], eventId: undefined }] },
      { ...definition, actions: [{ ...definition.actions[1], eventId: "save-decision" }] },
    ]) {
      expect(workflowDefinitionSchema.safeParse(invalidDefinition).success).toBe(false);
    }
  });

  test("rejects unknown fields, callbacks, and invalid fact declarations", () => {
    const definition = createDefinition();
    for (const invalidDefinition of [
      { ...definition, onStart: () => true },
      { ...definition, facts: [{ id: "decision", type: "enum", values: [] }] },
      { ...definition, facts: [{ id: "decision", type: "enum", values: [Infinity] }] },
      { ...definition, facts: [{ id: "decision", type: "object" }] },
      { ...definition, facts: [{ id: "decision", type: "boolean", values: [true] }] },
      {
        ...definition,
        actions: [
          {
            id: "view-notes",
            label: "View notes",
            kind: "view",
            availableWhen: { all: [{ not: () => true }] },
          },
        ],
      },
    ]) {
      expect(workflowDefinitionSchema.safeParse(invalidDefinition).success).toBe(false);
    }
  });

  test("rejects reserved fact IDs in declarations and conditions without limiting other IDs", () => {
    for (const result of [
      workflowFactDefinitionSchema.safeParse({ id: "__proto__", type: "boolean" }),
      workflowConditionSchema.safeParse({ fact: "__proto__", equals: true }),
    ]) {
      expect(result.success).toBe(false);
      if (result.success) throw new Error("Expected the reserved fact ID to fail validation.");
      expect(result.error.message).toContain(
        'Fact ID \\"__proto__\\" is reserved. Use another fact ID.',
      );
    }
    const definition = createDefinition();
    expect(
      workflowDefinitionSchema.safeParse({
        ...definition,
        roles: [{ id: "__proto__", label: "Reviewer" }],
        events: [{ ...definition.events[0], id: "__proto__" }],
      }).success,
    ).toBe(true);
  });
});
