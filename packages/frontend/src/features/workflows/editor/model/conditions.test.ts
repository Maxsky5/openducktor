import { describe, expect, test } from "bun:test";
import { newWorkflowDocument } from "@openducktor/workflows";
import { addState } from "./create-elements";
import { conditionOfKind, conditionSentence } from "./conditions";

const definition = addState(newWorkflowDocument("flow", "Flow"), "Review").document.definition;

describe("condition sentence", () => {
  test("reads a group in plain words, with a nested group in brackets", () => {
    expect(
      conditionSentence(
        {
          all: [
            { stateIn: ["open", "review"] },
            { any: [{ not: { stateIn: ["closed"] } }, false] },
          ],
        },
        definition,
      ),
    ).toBe("the task is in Backlog or Review and (the task is not in Done or never)");
  });

  test("reads a single test", () => {
    expect(conditionSentence(true, definition)).toBe("always");
    expect(conditionSentence({ stateIn: ["open", "review", "closed"] }, definition)).toBe(
      "the task is in Backlog, Review, or Done",
    );
  });
});

describe("conditionOfKind", () => {
  const definition = newWorkflowDocument("flow", "Flow").definition;

  test("keeps the only part of a group when the new kind is the kind of that part", () => {
    const part = { stateIn: ["closed"] };
    expect(conditionOfKind("stateIn", { all: [part] }, definition)).toBe(part);
    expect(conditionOfKind("stateIn", { not: part }, definition)).toBe(part);
  });

  test("starts empty when the group has more than one part", () => {
    const group = { any: [{ stateIn: ["open"] }, { stateIn: ["closed"] }] };
    expect(conditionOfKind("stateIn", group, definition)).toEqual({ stateIn: [] });
  });
});
