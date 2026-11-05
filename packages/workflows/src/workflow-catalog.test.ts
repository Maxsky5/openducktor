import { describe, expect, test } from "bun:test";
import {
  promptOverrideKey,
  workflowDefinitionSchema,
  type WorkflowDefinition,
} from "@openducktor/contracts";
import { specPlanBuildWorkflow } from "./builtin/spec-plan-build/workflow";
import { SPEC_PLAN_BUILD_BOARD_LAYOUT } from "./builtin/spec-plan-build/board";
import {
  createReviewTaskWorkflow,
  reviewTaskPromptTemplates,
  reviewTaskRoles,
} from "../test-support/review-task-workflow";
import { createTaskWorkflow } from "./task-workflow/task-workflow";
import {
  compileWorkflowCatalog,
  requireCatalogWorkflow,
  resolveWorkflowBoard,
  validateWorkflowInventory,
  taskWorkflowDescriptor,
  workflowRoleCatalog,
  type WorkflowBoardLayout,
} from "./workflow-catalog";

const review = createReviewTaskWorkflow();
const variant = (change: (definition: WorkflowDefinition) => void) => {
  const definition = workflowDefinitionSchema.parse(structuredClone(review.definition));
  definition.id = "second-editorial";
  definition.revision = 3;
  change(definition);
  return createTaskWorkflow(definition, reviewTaskPromptTemplates, reviewTaskRoles);
};
// Both workflows share the core states, so each review-only state follows one built-in state.
const reviewOnlyStates = review.definition.states.filter(
  ({ id }) => !SPEC_PLAN_BUILD_BOARD_LAYOUT.states.some((state) => state.id === id),
);
const layout: WorkflowBoardLayout = {
  states: SPEC_PLAN_BUILD_BOARD_LAYOUT.states.flatMap((state, index) => {
    const reviewState = reviewOnlyStates[index];
    return reviewState ? [state, { id: reviewState.id, taskOrder: "updated" as const }] : [state];
  }),
};

describe("workflow catalog and shared board", () => {
  test("resolves explicit interleaved columns with metadata from the definitions", () => {
    const board = resolveWorkflowBoard(layout, [specPlanBuildWorkflow, review]);
    expect(board.states.slice(0, 4).map(({ id }) => id)).toEqual([
      "open",
      "writing",
      "spec_ready",
      "paused",
    ]);
    expect(board.states).toHaveLength(12);
    expect(board.states.find(({ id }) => id === "spec_ready")).toEqual({
      id: "spec_ready",
      label: "Spec ready",
      title: "Spec Ready",
      shortLabel: "Spec",
      tone: "pending",
      taskOrder: "updated",
    });
  });

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

  test("shares state identity across definitions and rejects conflicts or missing states", () => {
    expect(
      resolveWorkflowBoard(layout, [specPlanBuildWorkflow, review, variant(() => {})]).states,
    ).toHaveLength(12);
    const relabelled = variant((definition) => {
      definition.states.find(({ id }) => id === "reviewing")!.label = "Different review";
    });
    expect(() => validateWorkflowInventory([review, relabelled])).toThrow("reviewing");
    const retoned = variant((definition) => {
      definition.states.find(({ id }) => id === "reviewing")!.tone = "warning";
    });
    expect(() => validateWorkflowInventory([review, retoned])).toThrow("reviewing");
    const relabelledCore = variant((definition) => {
      definition.states.find(({ id }) => id === "closed")!.label = "Published";
    });
    expect(() => validateWorkflowInventory([review, relabelledCore])).toThrow("closed");
    expect(() =>
      resolveWorkflowBoard({ states: layout.states.filter(({ id }) => id !== "reviewing") }, [
        review,
      ]),
    ).toThrow('missing state "reviewing"');
    expect(() =>
      resolveWorkflowBoard({ states: [...layout.states, layout.states[0]!] }, [review]),
    ).toThrow('repeats state "open"');
    expect(() => resolveWorkflowBoard(layout, [review])).toThrow(
      'Board state "spec_ready" belongs to no workspace workflow',
    );
  });

  test("rejects notification defaults that share a saved key but use different policies", () => {
    const other = variant((definition) => {
      definition.states.find(({ id }) => id === "reviewing")!.notification!.defaultSetting.enabled =
        false;
    });
    expect(() => validateWorkflowInventory([review, other])).toThrow(
      'Notification "workflow.reviewing"',
    );
  });

  test("rejects a role that differs between workflows", () => {
    const relabelled = createTaskWorkflow(
      { ...workflowDefinitionSchema.parse(structuredClone(review.definition)), id: "second" },
      reviewTaskPromptTemplates,
      reviewTaskRoles.map((role) => (role.id === "editor" ? { ...role, label: "Other" } : role)),
    );
    expect(() => validateWorkflowInventory([review, relabelled])).toThrow(
      'Role "editor" differs between workflows',
    );
  });

  test("lets two workflows use the same prompt ID with different text", () => {
    const rewritten = createTaskWorkflow(
      { ...workflowDefinitionSchema.parse(structuredClone(review.definition)), id: "third" },
      reviewTaskPromptTemplates.map((template) =>
        template.id === "messages.edit_review" ? { ...template, template: "Other" } : template,
      ),
      reviewTaskRoles,
    );
    expect(() => validateWorkflowInventory([review, rewritten])).not.toThrow();
    const kickoffKeys = [review, rewritten].map(
      ({ prompts }) => prompts.templates.find(({ id }) => id === "messages.edit_review")?.key,
    );
    expect(kickoffKeys).toEqual([
      promptOverrideKey({
        ownerKind: "workflow",
        ownerId: "review",
        promptId: "messages.edit_review",
      }),
      promptOverrideKey({
        ownerKind: "workflow",
        ownerId: "third",
        promptId: "messages.edit_review",
      }),
    ]);
  });

  test("rejects invalid display references in the definition", () => {
    expect(() =>
      variant((definition) => {
        definition.roles.find(({ id }) => id === "writer")!.defaultArtifact = "missing";
      }),
    ).toThrow('Unknown artifacts ID "missing"');
  });
});
