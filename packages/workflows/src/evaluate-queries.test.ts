import { describe, expect, test } from "bun:test";
import { publicationDefinition, publicationInput } from "../test-support/publication-workflow";
import { createWorkflow } from "./evaluate";

describe("generic workflow launch, label, and order queries", () => {
  test("selects the first launch action whose condition matches, else the first one", () => {
    const workflow = createWorkflow(publicationDefinition());
    const draft = (verdict?: string) =>
      publicationInput(
        "draft",
        {},
        {
          "first-review": verdict === undefined ? { present: false } : { present: true, verdict },
        },
      );
    expect(workflow.stepLaunchAction(draft(), "write")).toBe("write-draft");
    expect(workflow.stepLaunchAction(draft("approved"), "write")).toBe("write-draft");
    expect(workflow.stepLaunchAction(draft("changes"), "write")).toBe("revise-draft");
    expect(workflow.actionLaunchAction(draft("changes"), "start-writing")).toBe("revise-draft");
    expect(workflow.actionLaunchAction(draft(), "start-writing")).toBe("write-draft");
    expect(workflow.stepLaunchAction(draft(), "review-second")).toBe("review-second");
  });

  test("reports steps and actions that start no session", () => {
    const workflow = createWorkflow(publicationDefinition());
    const input = publicationInput("draft");
    expect(() => workflow.stepLaunchAction(input, "approve")).toThrow(
      expect.objectContaining({ code: "unknown_step" }),
    );
    expect(() => workflow.actionLaunchAction(input, "view-copy")).toThrow(
      expect.objectContaining({ code: "missing_launch_action" }),
    );
    expect(() => workflow.actionLaunchAction(input, "missing")).toThrow(
      expect.objectContaining({ code: "unknown_action" }),
    );
  });

  test("uses the first matching label variant, else the action label", () => {
    const workflow = createWorkflow(publicationDefinition());
    expect(
      workflow.actionLabel(
        publicationInput("draft", {}, { "first-review": { present: true, verdict: "changes" } }),
        "start-writing",
      ),
    ).toBe("Revise copy");
    expect(
      workflow.actionLabel(
        publicationInput("draft", {}, { "first-review": { present: false } }),
        "start-writing",
      ),
    ).toBe("Start writing");
    expect(workflow.actionLabel(publicationInput("draft"), "view-copy")).toBe("View copy");
  });

  test("orders actions by the first priority rule, then the first order rule, then input order", () => {
    const workflow = createWorkflow(publicationDefinition());
    const actions = ["view-copy", "finish-second", "submit", "publish", "start-writing"];
    expect(workflow.orderActions(publicationInput("draft", { hold: false }), actions)).toEqual([
      "start-writing",
      "submit",
      "publish",
      "view-copy",
      "finish-second",
    ]);
    expect(
      workflow.orderActions(publicationInput("first-review", { hold: true }), actions),
    ).toEqual(["view-copy", "submit", "finish-second", "publish", "start-writing"]);
    expect(
      workflow.orderActions(publicationInput("draft", { hold: false }), actions, ["view-copy"]),
    ).toEqual(["view-copy", "publish", "submit", "finish-second", "start-writing"]);
  });
});
