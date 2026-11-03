import { expect, test } from "bun:test";
import { workflowDefinitionSchema } from "@openducktor/contracts";
import { createTaskWorkflow } from "@openducktor/workflows";
import { createSharedBoardWorkflows } from "@openducktor/workflows/test-support";
import { createTaskWorkflowResolver } from "./task-workflows";

const scope = { workspaceId: "workspace", repoPath: "/repo" };

const fixture = () => {
  const shared = createSharedBoardWorkflows();
  const source = {
    workflows: shared.workflows,
    forTask: () => shared.alpha,
    forNewTask: () => shared.alpha,
    forWorkspace: () => ({ board: shared.layout, workflows: shared.workflows }),
  };
  return { ...shared, source };
};

test("resolves exact revisions and keeps the workspace creation workflow in the validated inventory", async () => {
  const f = fixture();
  const revision = createTaskWorkflow(
    workflowDefinitionSchema.parse({ ...f.alpha.definition, revision: 2 }),
    f.alpha.prompts.templates,
  );
  const workflows = [...f.workflows, revision];
  const module = createTaskWorkflowResolver({
    ...f.source,
    workflows,
    forWorkspace: () => ({ board: f.layout, workflows }),
  });
  expect(module.forReference({ id: "alpha", revision: 1 }).definition.revision).toBe(1);
  expect(module.forReference({ id: "alpha", revision: 2 }).definition.revision).toBe(2);
  expect(() => module.forReference({ id: "alpha", revision: 3 })).toThrow("alpha@3");
  expect(module.forWorkspace(scope).newTaskWorkflow.definition.id).toBe("alpha");
  expect(
    module
      .catalog("host-a")
      .workflows.map(({ definition: { id, revision } }) => ({ id, revision })),
  ).toEqual([
    { id: "alpha", revision: 1 },
    { id: "beta", revision: 1 },
    { id: "alpha", revision: 2 },
  ]);
  expect(module.catalog("host-a").hostInstanceId).toBe("host-a");
});

test("rejects task resolution outside the registered inventory", () => {
  const f = fixture();
  const module = createTaskWorkflowResolver({
    ...f.source,
    workflows: [f.alpha],
    forTask: () => f.beta,
  });
  expect(() => module.forTask({ id: "task" })).toThrow("not registered");
});

test.each(["missing state", "unregistered workflow", "creation outside workspace"] as const)(
  "rejects an invalid workspace: %s",
  (failure) => {
    const f = fixture();
    const module = createTaskWorkflowResolver({
      ...f.source,
      workflows: failure === "unregistered workflow" ? [f.alpha] : f.workflows,
      forWorkspace: () => ({
        board:
          failure === "missing state"
            ? { states: f.layout.states.filter(({ id }) => id !== "shared_review") }
            : f.layout,
        workflows: failure === "creation outside workspace" ? [f.beta] : f.workflows,
      }),
    });
    expect(() => module.forWorkspace(scope)).toThrow(
      failure === "missing state"
        ? "missing state"
        : failure === "unregistered workflow"
          ? "not registered"
          : "new-task workflow",
    );
  },
);

test("rejects conflicting shared workflow states when constructing the host module", () => {
  const f = fixture();
  const definition = workflowDefinitionSchema.parse(f.beta.definition);
  definition.states.find(({ id }) => id === "shared_review")!.label = "Different review";
  const conflicting = createTaskWorkflow(definition, f.beta.prompts.templates);
  expect(() =>
    createTaskWorkflowResolver({ ...f.source, workflows: [f.alpha, conflicting] }),
  ).toThrow('Shared state "shared_review" conflicts');
});
