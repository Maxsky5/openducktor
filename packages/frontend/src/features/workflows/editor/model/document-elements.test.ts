import { describe, expect, test } from "bun:test";
import { newWorkflowDocument } from "@openducktor/workflows";
import { addAction, addEvent, addState } from "./create-elements";
import { eventNames, eventRouteLabel, eventSourcesTitle } from "./document-elements";
import { updateElement } from "./document-edits";

/** Backlog, Triage, Fixing, Done, with two events from three states into Fixing. */
const document = () => {
  let value = newWorkflowDocument("flow", "Flow");
  value = addState(value, "Triage").document;
  value = addState(value, "Fixing").document;
  for (const id of ["reject", "rework"]) {
    value = addEvent(value, "open", "fixing", id).document;
    // Without a name, a transition takes the name of its triggers, else of its route.
    value = updateElement(value, "event", id, ({ label: _label, ...event }) => ({
      ...event,
      from: ["open", "triage", "closed"],
    }));
  }
  return value;
};

describe("event route labels", () => {
  test("a route says any state when its sources hold every state that a task leaves", () => {
    const definition = document().definition;
    const event = definition.events[0]!;
    expect(eventRouteLabel(definition, event)).toBe("Any state → Fixing");
    expect(eventSourcesTitle(definition, event)).toBe("From: Backlog, Triage, Done");
  });

  test("a route names only the sources where a branch moves the task", () => {
    const definition = updateElement(document(), "event", "reject", (event) => ({
      ...event,
      outcomes: [
        { when: { stateIn: ["open"] }, to: "fixing" },
        { when: true, to: "triage" },
      ],
    })).definition;
    // From Triage, the fallback branch keeps the state, so Triage is no source of the route.
    expect(eventRouteLabel(definition, definition.events[0]!)).toBe(
      "Backlog, Done → Fixing, Triage",
    );
  });

  test("a route counts more than two sources that leave a state out", () => {
    const definition = addState(document(), "Review").document.definition;
    expect(eventRouteLabel(definition, definition.events[0]!)).toBe("3 states → Fixing");
  });

  test("a transition is named by its triggers, and the same triggers add their targets", () => {
    let value = addAction(document(), "Send back", "event").document;
    value = updateElement(value, "action", "send_back", (action) =>
      action.kind === "event" ? { ...action, eventId: "reject" } : action,
    );
    expect(eventNames(value.definition)).toEqual(
      new Map([
        ["reject", "Send back"],
        ["rework", "Any state → Fixing"],
      ]),
    );
    value = addAction(value, "Send back", "event").document;
    value = updateElement(value, "action", "send_back_2", (action) =>
      action.kind === "event" ? { ...action, eventId: "rework" } : action,
    );
    expect(eventNames(value.definition)).toEqual(
      new Map([
        ["reject", "Send back → Fixing · reject"],
        ["rework", "Send back → Fixing · rework"],
      ]),
    );
  });
});
