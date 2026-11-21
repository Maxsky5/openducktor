import { describe, expect, test } from "bun:test";
import { builtinWorkflowDocument, newWorkflowDocument } from "@openducktor/workflows";
import { addEvent, addState } from "./create-elements";
import { gettingStartedSteps } from "./getting-started";

const done = (steps: ReturnType<typeof gettingStartedSteps>) =>
  steps.filter((step) => step.done).map(({ id }) => id);

describe("getting started", () => {
  test("a blank workflow has every step left, and names the state to connect", () => {
    const steps = gettingStartedSteps(newWorkflowDocument("flow", "Flow").definition, {
      published: false,
      hasDraft: true,
    });
    expect(done(steps)).toEqual([]);
    expect(steps[1]!.how).toContain("“Backlog”");
  });

  test("each edit checks its step", () => {
    let document = addState(newWorkflowDocument("flow", "Flow"), "Review").document;
    document = addEvent(document, "open", "review").document;
    document = addEvent(document, "review", "closed").document;
    expect(
      done(gettingStartedSteps(document.definition, { published: false, hasDraft: true })),
    ).toEqual(["columns", "connect"]);
  });

  test("a published copy of the built-in workflow has every step done", () => {
    expect(
      done(
        gettingStartedSteps(builtinWorkflowDocument().definition, {
          published: true,
          hasDraft: false,
        }),
      ),
    ).toEqual(["columns", "connect", "triggers", "agent", "publish"]);
  });

  test("names the problems to fix while they block the publication", () => {
    const steps = gettingStartedSteps(newWorkflowDocument("flow", "Flow").definition, {
      published: false,
      hasDraft: true,
      errorCount: 2,
    });
    expect(steps.at(-1)).toMatchObject({ id: "publish", title: "Fix 2 problems", done: false });
  });
});
