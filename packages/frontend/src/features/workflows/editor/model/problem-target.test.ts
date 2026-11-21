import { describe, expect, test } from "bun:test";
import { builtinWorkflowDocument, elementKey, formatProblemPath } from "@openducktor/workflows";
import { problemTarget, PROMPTS_KEY, WORKFLOW_KEY } from "./document-elements";
import { findField } from "./field-focus";

const document = builtinWorkflowDocument();
const definition = document.definition;

describe("problem target", () => {
  test("a path into a list item selects that element and keeps the field path", () => {
    const event = definition.events[2]!;
    expect(problemTarget(document, ["definition", "events", 2, "outcomes", 0, "to"])).toEqual({
      key: elementKey("event", event.id),
      fieldPath: ["outcomes", 0, "to"],
    });
    const step = definition.steps[0]!;
    expect(
      problemTarget(document, ["definition", "steps", 0, "launchActions", 1, "template", "id"]),
    ).toEqual({
      key: elementKey("step", step.id),
      fieldPath: ["launchActions", 1, "template", "id"],
    });
  });

  test("a whole element path selects the element without a field", () => {
    expect(problemTarget(document, ["definition", "states", 1])).toEqual({
      key: elementKey("state", definition.states[1]!.id),
      fieldPath: [],
    });
  });

  test("rule lists, prompts, and workflow fields have their own targets", () => {
    expect(problemTarget(document, ["definition", "actionOrder", 0, "actions", 2])).toEqual({
      key: elementKey("actionOrder"),
      fieldPath: [0, "actions", 2],
    });
    expect(problemTarget(document, ["prompts", 0, "template"])).toEqual({
      key: elementKey("prompt", document.prompts[0]!.id),
      fieldPath: ["template"],
    });
    expect(problemTarget(document, ["prompts"])).toEqual({ key: PROMPTS_KEY, fieldPath: [] });
    expect(problemTarget(document, ["definition", "issueTypes"])).toEqual({
      key: WORKFLOW_KEY,
      fieldPath: ["issueTypes"],
    });
    expect(problemTarget(document, ["definition", "id"])).toEqual({
      key: WORKFLOW_KEY,
      fieldPath: ["id"],
    });
  });

  test("an index past the list end selects the workflow", () => {
    expect(problemTarget(document, ["definition", "events", 999, "id"]).key).toBe(WORKFLOW_KEY);
  });
});

describe("field focus", () => {
  const container = () => {
    const root = window.document.createElement("div");
    for (const path of [["outcomes"], ["outcomes", 0, "to"], ["outcomes", 0, "when"], ["from"]]) {
      const field = window.document.createElement("div");
      field.setAttribute("data-field-path", formatProblemPath(path));
      field.append(window.document.createElement("input"));
      root.append(field);
    }
    return root;
  };

  test("finds the field of the exact path", () => {
    expect(findField(container(), ["outcomes", 0, "to"])?.getAttribute("data-field-path")).toBe(
      "outcomes[0].to",
    );
  });

  test("finds the nearest field of a deeper path", () => {
    expect(
      findField(container(), ["outcomes", 0, "when", "all", 1, "stateIn", 0])?.getAttribute(
        "data-field-path",
      ),
    ).toBe("outcomes[0].when");
    expect(findField(container(), ["outcomes", 3, "signal"])?.getAttribute("data-field-path")).toBe(
      "outcomes",
    );
  });

  test("finds no field for an unrelated path", () => {
    expect(findField(container(), ["guards", 0])).toBeNull();
  });
});
