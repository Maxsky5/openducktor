import { describe, expect, test } from "bun:test";
import { workflowDefinitionSchema, type WorkflowDefinition } from "@openducktor/contracts";
import { builtinTaskWorkflow } from "./builtin/task-workflow";
import { BUILTIN_BOARD_LAYOUT } from "./builtin/board";
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
      roles: [...workflowRoleCatalog([builtinTaskWorkflow, review])],
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
    expect(() => validateWorkflowInventory([review, relabelled])).toThrow("reviewing");
    const retoned = variant((definition) => {
      definition.states.find(({ id }) => id === "reviewing")!.tone = "warning";
    });
    expect(() => validateWorkflowInventory([review, retoned])).toThrow("reviewing");
    const open = variant((definition) => {
      definition.states.find(({ id }) => id === "published")!.terminal = false;
    });
    expect(() => validateWorkflowInventory([review, open])).toThrow("published");
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
    expect(() => validateWorkflowInventory([review, other])).toThrow(
      'Notification "workflow.reviewing"',
    );
  });

  test("rejects a role or template that differs between workflows", () => {
    const relabelled = createTaskWorkflow(
      { ...workflowDefinitionSchema.parse(structuredClone(review.definition)), id: "second" },
      reviewTaskPromptTemplates,
      reviewTaskRoles.map((role) => (role.id === "editor" ? { ...role, label: "Other" } : role)),
    );
    expect(() => validateWorkflowInventory([review, relabelled])).toThrow(
      'Role "editor" differs between workflows',
    );
    const rewritten = createTaskWorkflow(
      { ...workflowDefinitionSchema.parse(structuredClone(review.definition)), id: "third" },
      reviewTaskPromptTemplates.map((template) =>
        template.id === "kickoff.edit_review" ? { ...template, template: "Other" } : template,
      ),
      reviewTaskRoles,
    );
    expect(() => validateWorkflowInventory([review, rewritten])).toThrow(
      'Prompt template "kickoff.edit_review" differs between workflows',
    );
  });

  test("compares templates across the latest revision of each workflow, in any catalog order", () => {
    const revise = (id: string, revision: number, text: string) =>
      createTaskWorkflow(
        { ...workflowDefinitionSchema.parse(structuredClone(review.definition)), id, revision },
        reviewTaskPromptTemplates.map((template) =>
          template.id === "kickoff.edit_review" ? { ...template, template: text } : template,
        ),
        reviewTaskRoles,
      );
    // The old revision keeps its own template; the latest revisions agree.
    expect(() =>
      validateWorkflowInventory([revise("a", 1, "v1"), revise("a", 2, "v2"), revise("b", 1, "v2")]),
    ).not.toThrow();
    // The latest revision of "a" disagrees with "b", even after "b" matched the old revision.
    expect(() =>
      validateWorkflowInventory([revise("a", 1, "v1"), revise("b", 1, "v1"), revise("a", 2, "v2")]),
    ).toThrow('Prompt template "kickoff.edit_review" differs');
  });

  test("rejects invalid display references in the definition", () => {
    expect(() =>
      variant((definition) => {
        definition.roles.find(({ id }) => id === "writer")!.defaultArtifact = "missing";
      }),
    ).toThrow('Unknown artifacts ID "missing"');
  });
});
