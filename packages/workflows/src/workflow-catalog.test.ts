import { describe, expect, test } from "bun:test";
import { workflowDefinitionSchema, type WorkflowDefinition } from "@openducktor/contracts";
import { specPlanBuildWorkflow } from "./builtin/spec-plan-build/workflow";
import {
  createReviewTaskWorkflow,
  reviewTaskPromptTemplates,
  reviewTaskRoles,
} from "../test-support/review-task-workflow";
import { workflowRoleCatalog } from "../test-support/shared-board-workflows";
import { createTaskWorkflow } from "./task-workflow/task-workflow";
import {
  compileWorkflowCatalog,
  requireCatalogWorkflow,
  resolveWorkspaceBoard,
  taskWorkflowDescriptor,
  validateWorkflowInventory,
} from "./workflow-catalog";

const review = createReviewTaskWorkflow();
const variant = (
  change: (definition: WorkflowDefinition) => void,
  templates = reviewTaskPromptTemplates,
) => {
  const definition = workflowDefinitionSchema.parse(structuredClone(review.definition));
  definition.id = "second-editorial";
  definition.revision = 3;
  change(definition);
  return createTaskWorkflow(definition, templates, reviewTaskRoles);
};
const basePrompts = reviewTaskPromptTemplates.filter(
  ({ id }) => !id.startsWith("messages.") || id === "messages.pull_request",
);
const ids = (board: ReturnType<typeof resolveWorkspaceBoard>) => board.states.map(({ id }) => id);

/** A workflow with only the given states, in that definition order, and nothing that uses them. */
const statesOnly = (id: string, stateIds: readonly string[]) =>
  variant((definition) => {
    definition.id = id;
    definition.states = stateIds.map(
      (stateId) =>
        review.definition.states.find((state) => state.id === stateId) ?? {
          id: stateId,
          label: stateId,
        },
    );
    definition.events = [];
    definition.actions = [];
    definition.steps = [];
    definition.artifacts = [];
    definition.signals = [];
    definition.automations = [];
    definition.actionOrder = [];
    definition.actionPriority = [];
    definition.launchOrder = [];
    definition.pullRequestRoles = [];
    definition.roles = [];
  }, basePrompts);

describe("workspace board", () => {
  test("puts open first, closed last, and the default workflow order between them", () => {
    const board = resolveWorkspaceBoard([
      { workflow: specPlanBuildWorkflow, latest: true },
      { workflow: review, latest: true },
    ]);
    // The review states spread across the board: early ones early, late ones late.
    expect(ids(board)).toEqual([
      "open",
      "spec_ready",
      "writing",
      "ready_for_dev",
      "paused",
      "in_progress",
      "blocked",
      "reviewing",
      "ai_review",
      "approval",
      "human_review",
      "closed",
    ]);
    expect(board.states[0]!.taskOrder).toBe("priority_then_created");
    expect(board.states[1]!.taskOrder).toBe("updated");
    expect(board.states.find(({ id }) => id === "spec_ready")).toEqual({
      id: "spec_ready",
      label: "Spec ready",
      title: "Spec Ready",
      shortLabel: "Spec ready",
      tone: "pending",
      taskOrder: "updated",
    });
  });

  test("puts new states between their nearest neighbors in their workflow", () => {
    const board = resolveWorkspaceBoard([
      { workflow: specPlanBuildWorkflow, latest: true },
      {
        workflow: statesOnly("design", ["open", "in_progress", "design_review", "closed"]),
        latest: true,
      },
    ]);
    const order = ids(board);
    expect(order.indexOf("design_review")).toBeGreaterThan(order.indexOf("in_progress"));
    expect(order.at(-1)).toBe("closed");
  });

  test("keeps early states of several workflows before the shared states that follow them", () => {
    const board = resolveWorkspaceBoard([
      { workflow: specPlanBuildWorkflow, latest: true },
      // A definition can list `closed` before its other states. The board still ends with it.
      {
        workflow: statesOnly("triage", ["open", "closed", "triage", "fixing", "test"]),
        latest: true,
      },
      {
        workflow: statesOnly("bug", [
          "open",
          "diagnosing",
          "ready_for_dev",
          "in_progress",
          "closed",
        ]),
        latest: true,
      },
      {
        workflow: statesOnly("perf", [
          "open",
          "profiling",
          "ready_for_dev",
          "in_progress",
          "closed",
        ]),
        latest: true,
      },
    ]);
    expect(ids(board)).toEqual([
      "open",
      "spec_ready",
      "diagnosing",
      "profiling",
      "triage",
      "ready_for_dev",
      "in_progress",
      "fixing",
      "blocked",
      "ai_review",
      "test",
      "human_review",
      "closed",
    ]);
  });

  test("takes the display of a state from a latest version first", () => {
    const older = variant((definition) => {
      definition.states.find(({ id }) => id === "writing")!.label = "Old writing";
    });
    const latest = variant((definition) => {
      definition.revision = 4;
    });
    const board = resolveWorkspaceBoard([
      { workflow: older, latest: false },
      { workflow: latest, latest: true },
    ]);
    expect(board.states.find(({ id }) => id === "writing")!.label).toBe("Writing");
  });

  test("takes display from a display-only version and adds none of its columns", () => {
    const older = variant((definition) => {
      definition.states.find(({ id }) => id === "writing")!.label = "Old writing";
    });
    const latest = variant((definition) => {
      definition.revision = 4;
    });
    const builtin = { workflow: specPlanBuildWorkflow, latest: true };
    const board = resolveWorkspaceBoard([
      builtin,
      { workflow: latest, latest: true, displayOnly: true },
      { workflow: older, latest: false },
    ]);
    expect(ids(board)).toEqual(
      ids(resolveWorkspaceBoard([builtin, { workflow: older, latest: false }])),
    );
    expect(board.states.find(({ id }) => id === "writing")!.label).toBe("Writing");
    expect(
      ids(resolveWorkspaceBoard([builtin, { workflow: latest, latest: true, displayOnly: true }])),
    ).toEqual(ids(resolveWorkspaceBoard([builtin])));
  });
});

describe("workflow catalog", () => {
  test("compiles each catalog workflow once and matches exact revisions", () => {
    const catalog = compileWorkflowCatalog({
      hostInstanceId: "host-a",
      roles: [...workflowRoleCatalog([specPlanBuildWorkflow, review])],
      workflows: [taskWorkflowDescriptor(specPlanBuildWorkflow), taskWorkflowDescriptor(review)],
    });
    const compiled = requireCatalogWorkflow(catalog, { id: "review", revision: 1 });
    expect(compiled.definition.roles.map(({ id }) => id)).toEqual(["writer", "editor"]);
    expect(requireCatalogWorkflow(catalog, { id: "review", revision: 1 })).toBe(compiled);
    expect(() => requireCatalogWorkflow(catalog, { id: "review", revision: 2 })).toThrow(
      "review@2",
    );
  });

  test("rejects a duplicate workflow version and accepts several versions of one workflow", () => {
    expect(() => validateWorkflowInventory([review, review])).toThrow(
      'Duplicate workflow "review@1"',
    );
    const next = variant((definition) => {
      definition.id = "review";
      definition.revision = 2;
    });
    expect(() => validateWorkflowInventory([review, next])).not.toThrow();
  });

  test("rejects invalid display references in the definition", () => {
    expect(() =>
      variant((definition) => {
        definition.roles.find(({ id }) => id === "writer")!.defaultArtifact = "missing";
      }),
    ).toThrow('uses the missing artifact "missing"');
  });
});
