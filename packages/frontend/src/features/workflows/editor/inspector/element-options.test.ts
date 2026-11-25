import { describe, expect, test } from "bun:test";
import { newWorkflowDocument } from "@openducktor/workflows";
import { addEvent, addState } from "../model/create-elements";
import { eventNames } from "../model/document-elements";
import { updateDefinition, updateElement } from "../model/document-edits";
import { elementOptions } from "./element-options";

const triageDocument = () => {
  let document = addState(newWorkflowDocument("flow", "Flow"), "Triage").document;
  document = addState(document, "Fixing").document;
  document = addEvent(document, "triage", "fixing", "start_fixing").document;
  document = addEvent(document, "open", null, "comment").document;
  // Without a name, a transition takes the name of its triggers, else of its route.
  return updateDefinition(document, (definition) => ({
    ...definition,
    events: definition.events.map(({ label: _label, ...event }) => event),
  }));
};

test("a named transition shows its name", () => {
  const document = addEvent(
    newWorkflowDocument("flow", "Flow"),
    "open",
    "closed",
    "finish",
  ).document;
  expect(elementOptions(document, []).events[0]?.label).toBe("Move to Done");
});

describe("element options", () => {
  test("an event option without a trigger names its route", () => {
    const { events } = elementOptions(triageDocument(), []);
    expect(events.map(({ value, label }) => ({ value, label }))).toEqual([
      { value: "start_fixing", label: "Triage → Fixing" },
      { value: "comment", label: "Stays in Backlog" },
    ]);
  });

  test("a state option shows its label and its colour, not its ID", () => {
    const { states } = elementOptions(triageDocument(), []);
    const triage = states.find(({ value }) => value === "triage");
    expect(triage?.label).toBe("Triage");
    expect(triage?.secondaryLabel).toBeUndefined();
    expect(triage?.icon).toBeTruthy();
  });

  test("an event from every state that a task leaves says any state", () => {
    const document = updateElement(triageDocument(), "event", "start_fixing", (event) => ({
      ...event,
      from: ["open", "triage", "closed"],
    }));
    expect(elementOptions(document, []).events[0]?.label).toBe("Any state → Fixing");
  });
});

describe("event names", () => {
  test("two events with the same route add their trigger or ID, so they never read the same", () => {
    const document = addEvent(triageDocument(), "triage", "fixing", "fix_now").document;
    const unnamed = updateElement(
      document,
      "event",
      "fix_now",
      ({ label: _label, ...event }) => event,
    );
    expect(eventNames(unnamed.definition)).toEqual(
      new Map([
        ["start_fixing", "Triage → Fixing · start_fixing"],
        ["comment", "Stays in Backlog"],
        ["fix_now", "Triage → Fixing · fix_now"],
      ]),
    );
    // A named transition keeps its name.
    expect(eventNames(document.definition).get("fix_now")).toBe("Move to Fixing");
  });
});
