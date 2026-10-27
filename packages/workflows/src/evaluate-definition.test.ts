import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "@openducktor/contracts";
import { publicationDefinition } from "../test-support/publication-workflow";
import { createWorkflow } from "./evaluate";

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
        definition.events.forEach((event) =>
          event.outcomes.forEach((outcome) => delete outcome.sourceRole),
        );
        definition.states.forEach((state) => {
          delete state.studioRole;
          if (state.notification) delete state.notification.role;
        });
      },
      path: "steps[0].roleId",
    },
    {
      name: "role write",
      change: (definition) => {
        definition.roles[0]!.writes = ["missing"];
      },
      path: "roles[0].writes[0]",
    },
    {
      name: "step start event",
      change: (definition) => {
        const step = definition.steps[0];
        if (step?.kind !== "agent") throw new Error("Expected an agent step.");
        step.startEventId = "missing";
      },
      path: "steps[0].startEventId",
    },
    {
      name: "document save event",
      change: (definition) => {
        definition.artifacts[0] = {
          id: "copy",
          label: "Copy",
          kind: "document",
          saveEventId: "missing",
        };
      },
      path: "artifacts[0].saveEventId",
    },
    {
      name: "verdict event",
      change: (definition) => {
        const artifact = definition.artifacts[1]!;
        if (artifact.kind === "review") artifact.verdicts[0]!.eventId = "missing";
      },
      path: "artifacts[1].verdicts[0].eventId",
    },
    {
      name: "notification role",
      change: (definition) => {
        definition.states[1]!.notification!.role = "missing";
      },
      path: "states[1].notification.role",
    },
    {
      name: "studio role",
      change: (definition) => {
        definition.states[0]!.studioRole = "missing";
      },
      path: "states[0].studioRole",
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
      name: "launch selection artifact",
      change: (definition) => {
        const step = definition.steps[0]!;
        if (step.kind === "agent")
          step.launchActions[1]!.selectWhen = { artifact: "missing", present: true };
      },
      path: "steps[0].launchActions[1].selectWhen.artifact",
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
      name: "action launch action",
      change: (definition) => {
        const action = definition.actions[1]!;
        if (action.kind === "session") action.launchActionIds = ["missing"];
      },
      path: "actions[1].launchActionIds[0]",
    },
    {
      name: "action label variant state",
      change: (definition) => {
        definition.actions[1]!.labels = [{ when: { stateIn: ["missing"] }, label: "Missing" }];
      },
      path: "actions[1].labels[0].when.stateIn[0]",
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
      name: "outcome signal",
      change: (definition) => {
        definition.events[0]!.outcomes[0]!.signal = "missing";
      },
      path: "events[0].outcomes[0].signal",
    },
    {
      name: "outcome source role",
      change: (definition) => {
        definition.events[0]!.outcomes[0]!.sourceRole = "missing";
      },
      path: "events[0].outcomes[0].sourceRole",
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
        definition.actions[5] = {
          id: "view-copy",
          label: "View copy",
          kind: "view",
          availableWhen: { any: [true, { not: { all: [{ stateIn: ["missing"] }] } }] },
        };
      },
      path: "actions[5].availableWhen.any[1].not.all[0].stateIn[0]",
    },
    {
      name: "signal automation",
      change: (definition) => {
        definition.signals[0]!.automations = ["missing"];
      },
      path: "signals[0].automations[0]",
    },
    {
      name: "automation launch action",
      change: (definition) => {
        definition.automations[0]!.launchActionId = "missing";
      },
      path: "automations[0].launchActionId",
    },
    {
      name: "order action",
      change: (definition) => {
        definition.actionOrder[0]!.actions = ["missing"];
      },
      path: "actionOrder[0].actions[0]",
    },
    {
      name: "priority action",
      change: (definition) => {
        definition.actionPriority[0]!.actions = ["missing"];
      },
      path: "actionPriority[0].actions[0]",
    },
    {
      name: "priority condition state",
      change: (definition) => {
        definition.actionPriority[0]!.when = { stateIn: ["missing"] };
      },
      path: "actionPriority[0].when.stateIn[0]",
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

  test.each([
    "facts",
    "roles",
    "artifacts",
    "states",
    "steps",
    "actions",
    "events",
    "signals",
    "automations",
  ] as const)("rejects duplicate IDs in %s", (collection) => {
    const definition = publicationDefinition();
    const items: Array<{ id: string }> = definition[collection];
    items.push(items[0]!);
    expect(() => createWorkflow(definition)).toThrow(
      expect.objectContaining({
        code: "invalid_definition",
        message: expect.stringContaining("Duplicate ID"),
      }),
    );
  });

  test("rejects duplicate launch action IDs across steps and duplicate verdict IDs", () => {
    const definition = publicationDefinition();
    const reviewStep = definition.steps[1]!;
    if (reviewStep.kind === "agent") reviewStep.launchActions[0]!.id = "write-draft";
    expect(() => createWorkflow(definition)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('Duplicate ID "write-draft" in steps[1].launchActions'),
      }),
    );
    const verdictDefinition = publicationDefinition();
    const artifact = verdictDefinition.artifacts[1]!;
    if (artifact.kind === "review") artifact.verdicts[1]!.id = "approved";
    expect(() => createWorkflow(verdictDefinition)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('Duplicate ID "approved" in artifacts[1].verdicts'),
      }),
    );
  });

  test("rejects a default start mode outside the launch action start modes", () => {
    const definition = publicationDefinition();
    const step = definition.steps[0]!;
    if (step.kind === "agent") step.launchActions[0]!.defaultStartMode = "reuse";
    expect(() => createWorkflow(definition)).toThrow(
      expect.objectContaining({
        code: "invalid_definition",
        message: expect.stringContaining("steps[0].launchActions[0].defaultStartMode"),
      }),
    );
  });

  test("rejects an automation start mode outside the launch action start modes", () => {
    const definition = publicationDefinition();
    definition.automations[0]!.startMode = "fork";
    expect(() => createWorkflow(definition)).toThrow(
      expect.objectContaining({
        code: "invalid_definition",
        message: expect.stringContaining(
          'Start mode "fork" at automations[0].startMode is not a start mode of launch action "review-first"',
        ),
      }),
    );
  });

  test("rejects duplicate guard IDs in one event", () => {
    const definition = publicationDefinition();
    definition.events[4]!.guards.push({ id: "approved", when: true });
    expect(() => createWorkflow(definition)).toThrow(
      expect.objectContaining({
        code: "invalid_definition",
        message: expect.stringContaining('Duplicate ID "approved" in events[4].guards'),
      }),
    );
  });

  test.each([
    { name: "undeclared fact", condition: { fact: "missing", equals: true }, path: ".fact" },
    { name: "boolean comparison", condition: { fact: "hold", equals: "true" }, path: ".equals" },
    { name: "number comparison", condition: { fact: "edition", equals: "2" }, path: ".equals" },
    { name: "string comparison", condition: { fact: "owner", equals: null }, path: ".equals" },
    { name: "enum comparison", condition: { fact: "channel", equals: "radio" }, path: ".equals" },
    {
      name: "undeclared artifact",
      condition: { artifact: "missing", present: true },
      path: ".artifact",
    },
    {
      name: "document verdict",
      condition: { artifact: "copy", verdict: "approved" },
      path: ".artifact",
    },
    {
      name: "undeclared verdict",
      condition: { artifact: "first-review", verdict: "missing" },
      path: ".verdict",
    },
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
