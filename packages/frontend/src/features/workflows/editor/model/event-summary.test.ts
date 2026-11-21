import { describe, expect, test } from "bun:test";
import { newWorkflowDocument } from "@openducktor/workflows";
import { addAction, addEvent } from "./create-elements";
import { updateElement } from "./document-edits";
import { eventSummary } from "./event-summary";

const document = () => {
  let value = addEvent(newWorkflowDocument("flow", "Flow"), "closed", "open", "reopen").document;
  value = addAction(value, "Reopen", "event").document;
  return updateElement(value, "action", "reopen", (action) =>
    action.kind === "event" ? { ...action, eventId: "reopen" } : action,
  );
};

describe("event summary", () => {
  test("names the trigger and the target", () => {
    const value = document();
    expect(eventSummary(value.definition, value.definition.events[0]!, new Map())).toBe(
      "The Reopen button moves the task to Backlog.",
    );
  });

  test("adds the reset and the roles that start fresh", () => {
    const value = updateElement(document(), "event", "reopen", (event) => ({
      ...event,
      effects: [{ id: "worktree.reset", clearsSessionsOf: ["build", "qa"] }],
    }));
    const labels = new Map([
      ["build", "Builder"],
      ["qa", "QA"],
    ]);
    expect(eventSummary(value.definition, value.definition.events[0]!, labels)).toBe(
      "The Reopen button moves the task to Backlog. It first resets the work and clears the sessions of Builder and QA.",
    );
  });

  test("says when nothing starts the transition", () => {
    const value = addEvent(
      newWorkflowDocument("flow", "Flow"),
      "open",
      "closed",
      "finish",
    ).document;
    expect(eventSummary(value.definition, value.definition.events[0]!, new Map())).toBe(
      "Nothing starts this transition yet. It moves the task to Done.",
    );
  });
});
