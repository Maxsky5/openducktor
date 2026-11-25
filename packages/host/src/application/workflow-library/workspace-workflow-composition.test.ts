import { describe, expect, test } from "bun:test";
import {
  createTaskWorkflow,
  resolveWorkspaceBoard,
  specPlanBuildWorkflow,
  type TaskWorkflow,
} from "@openducktor/workflows";
import {
  reviewTaskDefinition,
  reviewTaskPromptTemplates,
  reviewTaskRoles,
} from "@openducktor/workflows/test-support";
import { Effect } from "effect";
import {
  composeWorkspaceWorkflows,
  displayVersionRanges,
  orderAvailableWorkflows,
} from "./workspace-workflow-composition";

/** A version of a review workflow. `legacy` adds a state that later versions drop. */
const version = (
  id: string,
  label: string,
  revision: number,
  { legacy = false }: { legacy?: boolean } = {},
): TaskWorkflow => {
  const definition = reviewTaskDefinition();
  return createTaskWorkflow(
    {
      ...definition,
      id,
      label,
      revision,
      states: legacy
        ? [...definition.states, { id: "legacy", label: "Legacy" }]
        : definition.states,
    },
    reviewTaskPromptTemplates,
    reviewTaskRoles,
  );
};

const builtin = specPlanBuildWorkflow;
const zeta = version("zeta", "Zeta", 3);
const alpha = version("alpha", "Alpha", 2);
const latest = new Map([
  ["zeta", zeta],
  ["alpha", alpha],
]);

const order = (
  defaultWorkflowId: string,
  rules: { workflowId: string; mode: "only" | "except"; workspaceIds: string[] }[] = [],
  listedIds: ReadonlySet<string> = new Set(["zeta", "alpha"]),
) =>
  Effect.runSync(
    Effect.result(
      orderAvailableWorkflows("repo", { defaultWorkflowId, rules, listedIds }, builtin, latest),
    ),
  );
const ids = (ordered: ReturnType<typeof order>) =>
  ordered._tag === "Success" ? ordered.success.map(({ reference }) => reference.id) : ordered;

describe("orderAvailableWorkflows", () => {
  test("offers every published workflow, the default first, then by name", () => {
    expect(ids(order("alpha"))).toEqual(["alpha", builtin.reference.id, "zeta"]);
  });

  test("offers a workflow only where its rule allows the workspace", () => {
    expect(
      ids(
        order(builtin.reference.id, [
          { workflowId: "alpha", mode: "only", workspaceIds: ["other"] },
          { workflowId: "zeta", mode: "except", workspaceIds: ["other"] },
        ]),
      ),
    ).toEqual([builtin.reference.id, "zeta"]);
    expect(
      ids(
        order(builtin.reference.id, [
          { workflowId: "alpha", mode: "only", workspaceIds: ["repo"] },
          { workflowId: "zeta", mode: "except", workspaceIds: ["repo"] },
        ]),
      ),
    ).toEqual([builtin.reference.id, "alpha"]);
  });

  test("leaves out a deleted workflow that keeps its versions", () => {
    expect(ids(order(builtin.reference.id, [], new Set(["alpha"])))).toEqual([
      builtin.reference.id,
      "alpha",
    ]);
  });

  test("fails when the default workflow is not available", () => {
    const ordered = order("zeta", [{ workflowId: "zeta", mode: "except", workspaceIds: ["repo"] }]);
    expect(ordered._tag).toBe("Failure");
    if (ordered._tag !== "Failure") return;
    expect(ordered.failure.message).toContain('The default workflow "zeta" is not available');
  });
});

describe("displayVersionRanges", () => {
  test("reads the versions after the oldest active version that has a dropped state", () => {
    const active = [
      version("zeta", "Zeta", 2, { legacy: true }),
      version("zeta", "Zeta", 1, { legacy: true }),
    ];
    expect(displayVersionRanges(active, latest)).toEqual([
      { workflowId: "zeta", after: 1, before: 3 },
    ]);
  });

  test("reads nothing when the latest version declares every state of the active versions", () => {
    expect(displayVersionRanges([version("zeta", "Zeta", 1), zeta], latest)).toEqual([]);
  });
});

describe("composeWorkspaceWorkflows", () => {
  test("orders the board by default and name, and lists each version in use once", () => {
    const zeta1 = version("zeta", "Zeta", 1);
    const composed = composeWorkspaceWorkflows({
      builtin,
      latest,
      available: [alpha, builtin],
      used: [zeta1, zeta1, alpha],
      active: [zeta1],
      displayVersions: [],
    });
    expect(composed.newTaskWorkflow).toEqual(alpha.reference);
    expect(composed.newTaskWorkflows).toEqual([alpha.reference, builtin.reference]);
    expect(composed.workflows).toEqual([alpha.reference, builtin.reference, zeta1.reference]);
    // Zeta is not available, so its latest version only gives the display of its states.
    expect(composed.board).toEqual(
      resolveWorkspaceBoard([
        { workflow: alpha, latest: true },
        { workflow: builtin, latest: true },
        { workflow: zeta, latest: true, displayOnly: true },
        { workflow: zeta1, latest: false },
      ]),
    );
  });
});
