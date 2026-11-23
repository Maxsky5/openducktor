import { describe, expect, test } from "bun:test";
import type { WorkflowDocument } from "@openducktor/contracts";
import {
  BUILTIN_ROLES,
  createTaskWorkflow,
  definitionOfDocument,
  newWorkflowDocument,
  promptTemplatesOfDocument,
  specPlanBuildWorkflow,
} from "@openducktor/workflows";
import { workflowTrackModel } from "./workflow-track-model";

const labels = (track: ReturnType<typeof workflowTrackModel>) =>
  track.stations.map(({ label }) => label);

describe("workflowTrackModel", () => {
  test("goes from the first column through each step and the approval to the last column", () => {
    const track = workflowTrackModel(specPlanBuildWorkflow, "bug");
    expect(labels(track)).toEqual([
      "Backlog",
      "Spec",
      "Planner",
      "Builder",
      "QA",
      "You approve",
      "Done",
    ]);
    // Only the screen reader text tells the steps that the type can skip.
    expect(track.text).toBe(
      "Backlog, then Spec (optional), then Planner (optional), then Builder, then QA, then You approve, then Done",
    );
  });

  const stepless = (edit: (document: WorkflowDocument) => WorkflowDocument) => {
    const document = edit(newWorkflowDocument("bugs", "Bugs"));
    return createTaskWorkflow(
      definitionOfDocument(document, 1),
      promptTemplatesOfDocument(document.prompts),
      BUILTIN_ROLES,
    );
  };

  test("follows the transitions through the columns of a workflow without steps", () => {
    const move = (id: string, from: string, to: string) => ({
      id,
      from: [from],
      guards: [],
      outcomes: [{ when: true, to }],
    });
    const workflow = stepless((document) => {
      const [open, closed] = document.definition.states;
      return {
        ...document,
        definition: {
          ...document.definition,
          states: [
            open!,
            { id: "triage", label: "Triage" },
            { id: "fixing", label: "Fixing" },
            { id: "test", label: "Test" },
            closed!,
          ],
          events: [
            move("start-triage", "open", "triage"),
            move("start-fixing", "triage", "fixing"),
            move("mark-fixed", "fixing", "test"),
            // Moves back from the last column do not change the path.
            move("retest", "closed", "test"),
            move("refix", "closed", "fixing"),
          ],
        },
      };
    });
    expect(labels(workflowTrackModel(workflow, "task"))).toEqual([
      "Backlog",
      "Triage",
      "Fixing",
      "Test",
      "Done",
    ]);
  });

  test("goes straight from the first column to the last one without a transition", () => {
    expect(
      labels(
        workflowTrackModel(
          stepless((document) => document),
          "task",
        ),
      ),
    ).toEqual(["Backlog", "Done"]);
  });
});
