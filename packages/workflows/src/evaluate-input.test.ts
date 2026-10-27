import { describe, expect, test } from "bun:test";
import { publicationDefinition, publicationInput } from "../test-support/publication-workflow";
import { createWorkflow, WorkflowEvaluationError } from "./evaluate";

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
      () => workflow.isEventAvailable(input, "publish"),
      () => workflow.decide(input, "publish"),
      () => workflow.stepLaunchAction(input, "write"),
      () => workflow.actionLaunchAction(input, "start-writing"),
      () => workflow.actionLabel(input, "view-copy"),
      () => workflow.orderActions(input, ["view-copy"]),
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
    { name: "boolean", facts: { hold: "true" }, path: "facts.hold" },
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
      workflow.availableActions(publicationInput("published", facts)).includes("view-copy"),
    ).toThrow(
      expect.objectContaining({ code: "invalid_input", message: expect.stringContaining(path) }),
    );
  });

  test.each([
    { name: "undeclared", artifacts: { unknown: { present: true } }, path: "artifacts.unknown" },
    {
      name: "document verdict",
      artifacts: { copy: { present: true, verdict: "approved" } },
      path: "artifacts.copy",
    },
    {
      name: "unknown verdict",
      artifacts: { "first-review": { present: true, verdict: "missing" } },
      path: "artifacts.first-review",
    },
    {
      name: "absent review verdict",
      artifacts: { "first-review": { present: false, verdict: "approved" } },
      path: "artifacts.first-review",
    },
  ])(
    "rejects a supplied $name artifact even when the query does not use it",
    ({ artifacts, path }) => {
      const workflow = createWorkflow(publicationDefinition());
      expect(() =>
        workflow
          .availableActions(publicationInput("published", {}, artifacts))
          .includes("view-copy"),
      ).toThrow(
        expect.objectContaining({ code: "invalid_input", message: expect.stringContaining(path) }),
      );
    },
  );

  test("reports unknown state, action, and event IDs", () => {
    const workflow = createWorkflow(publicationDefinition());
    expect(() => workflow.steps(publicationInput("missing"))).toThrow(
      expect.objectContaining({ code: "unknown_state" }),
    );
    expect(() => workflow.actionLabel(publicationInput("draft"), "missing")).toThrow(
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
