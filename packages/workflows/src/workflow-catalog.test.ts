import { describe, expect, test } from "bun:test";
import { workflowDefinitionSchema, type WorkflowDefinition } from "@openducktor/contracts";
import { builtinTaskWorkflow } from "./builtin/task-workflow";
import { BUILTIN_BOARD_LAYOUT } from "./builtin/board";
import {
  createReviewTaskWorkflow,
  reviewTaskPromptTemplates,
} from "../test-support/review-task-workflow";
import { createTaskWorkflow } from "./task-workflow/task-workflow";
import {
  compileWorkflowCatalog,
  requireCatalogWorkflow,
  resolveWorkflowBoard,
  taskWorkflowDescriptor,
  type WorkflowBoardLayout,
} from "./workflow-catalog";

const review = createReviewTaskWorkflow();
const variant = (change: (definition: WorkflowDefinition) => void) => {
  const definition = workflowDefinitionSchema.parse(structuredClone(review.definition));
  definition.id = "second-editorial";
  definition.revision = 3;
  change(definition);
  return createTaskWorkflow(definition, reviewTaskPromptTemplates);
};
const layout: WorkflowBoardLayout = {
  states: review.definition.states
    .flatMap((state, index) => [
      ...(BUILTIN_BOARD_LAYOUT.states[index] ? [BUILTIN_BOARD_LAYOUT.states[index]!] : []),
      { id: state.id, taskOrder: "updated" as const },
    ])
    .concat(BUILTIN_BOARD_LAYOUT.states.slice(review.definition.states.length)),
};

describe("workflow catalog and shared board", () => {
  test("resolves explicit interleaved columns with metadata from the definitions", () => {
    const board = resolveWorkflowBoard(layout, [builtinTaskWorkflow, review]);
    expect(board.states.slice(0, 4).map(({ id }) => id)).toEqual([
      "open",
      "backlog",
      "spec_ready",
      "writing",
    ]);
    expect(board.states).toHaveLength(15);
    expect(board.states.find(({ id }) => id === "spec_ready")).toEqual({
      id: "spec_ready",
      label: "Spec ready",
      title: "Spec Ready",
      shortLabel: "Spec ready",
      terminal: false,
      tone: "pending",
      taskOrder: "updated",
    });
  });

  test("compiles each catalog workflow once and matches exact revisions", () => {
    const catalog = compileWorkflowCatalog({
      hostInstanceId: "host-a",
      workflows: [taskWorkflowDescriptor(builtinTaskWorkflow), taskWorkflowDescriptor(review)],
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
      resolveWorkflowBoard(layout, [builtinTaskWorkflow, review, variant(() => {})]).states,
    ).toHaveLength(15);
    const relabelled = variant((definition) => {
      definition.states.find(({ id }) => id === "reviewing")!.label = "Different review";
    });
    expect(() => resolveWorkflowBoard(layout, [review, relabelled])).toThrow("reviewing");
    const retoned = variant((definition) => {
      definition.states.find(({ id }) => id === "reviewing")!.tone = "warning";
    });
    expect(() => resolveWorkflowBoard(layout, [review, retoned])).toThrow("reviewing");
    const open = variant((definition) => {
      definition.states.find(({ id }) => id === "published")!.terminal = false;
    });
    expect(() => resolveWorkflowBoard(layout, [review, open])).toThrow("published");
    expect(() =>
      resolveWorkflowBoard({ states: layout.states.filter(({ id }) => id !== "reviewing") }, [
        review,
      ]),
    ).toThrow('missing state "reviewing"');
    expect(() =>
      resolveWorkflowBoard({ states: [...layout.states, layout.states[0]!] }, [review]),
    ).toThrow('repeats state "open"');
    expect(() => resolveWorkflowBoard(layout, [review])).toThrow(
      'Board state "open" belongs to no workspace workflow',
    );
  });

  test("rejects notification defaults that share a saved key but use different policies", () => {
    const other = variant((definition) => {
      definition.states.find(({ id }) => id === "reviewing")!.notification!.defaultSetting.enabled =
        false;
    });
    expect(() => resolveWorkflowBoard(layout, [review, other])).toThrow(
      'Notification "workflow.reviewing"',
    );
  });

  test("rejects invalid display references in the definition", () => {
    expect(() =>
      variant((definition) => {
        definition.roles.find(({ id }) => id === "writer")!.defaultArtifact = "missing";
      }),
    ).toThrow('Unknown artifacts ID "missing"');
  });
});
