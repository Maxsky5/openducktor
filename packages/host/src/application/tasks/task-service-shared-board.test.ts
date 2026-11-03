import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { TaskWorkflow } from "@openducktor/workflows";
import { createSharedBoardWorkflows } from "@openducktor/workflows/test-support";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createTaskWorkflowResolver } from "./task-workflows";
import { createWorkflowReads } from "./workflow-reads";
import {
  createBuildSettingsConfig,
  createBuildStartGitPort,
  createBuildSystemCommands,
  createBuildWorkspaceSettingsService,
  createTaskService,
} from "./test-support/task-workflow-harness";

test("one workspace keeps mixed-workflow projections and mutations separate in shared states", async () => {
  const { alpha, beta, workflows, board } = createSharedBoardWorkflows();
  // Assignment is an injected fixture, never a task record or a stored workflow binding.
  const assigned = new Map<string, TaskWorkflow>();
  let creating: TaskWorkflow | null = null;
  const resolver = createTaskWorkflowResolver({
    workflows,
    forWorkspace: () => ({ workflows, board }),
    forNewTask: () => creating ?? alpha,
    forTask: ({ id }) => {
      const workflow = assigned.get(id);
      if (workflow) return workflow;
      if (!creating) throw new Error(`No injected workflow for ${id}`);
      assigned.set(id, creating);
      return creating;
    },
  });
  const harness = await createSqliteTaskStoreHarness({ taskWorkflows: resolver });
  const repoPath = harness.repoPath;
  const workspaceId = harness.workspaceId;
  const service = createTaskService({
    atomicTaskStore: harness.store,
    taskWorkflows: resolver,
    gitPort: createBuildStartGitPort({ calls: [] }),
    settingsConfig: createBuildSettingsConfig(new Set([repoPath])),
    systemCommands: createBuildSystemCommands([]),
    workspaceSettingsService: createBuildWorkspaceSettingsService({
      workspaceId: "fairnest",
      repoPath,
      hooks: { postComplete: [] },
    }),
  });
  const create = async (workflow: TaskWorkflow) => {
    creating = workflow;
    try {
      return await Effect.runPromise(
        service.createTask({
          workspaceId,
          repoPath,
          task: { title: workflow.definition.label, issueType: "article", priority: 2 },
        }),
      );
    } finally {
      creating = null;
    }
  };
  const submit = (taskId: string, code: string, verdict?: string) => {
    const input: Parameters<typeof service.workflowArtifactSave>[0] = {
      workspaceId,
      repoPath,
      taskId,
      code,
      markdown: `# ${code}`,
      submit: true,
      sourceTool: "odt_set_task_artifact",
      updatedBy: "user",
    };
    if (verdict) input.verdict = verdict;
    return Effect.runPromise(service.workflowArtifactSave(input));
  };

  try {
    const first = await create(alpha);
    const second = await create(beta);
    await submit(first.id, "alpha_draft");
    await submit(second.id, "beta_draft");
    const tasks = await Effect.runPromise(service.listTasks({ workspaceId, repoPath }));
    expect(tasks.map(({ status }) => status)).toEqual(["shared_review", "shared_review"]);
    expect(tasks.find(({ id }) => id === first.id)).toMatchObject({
      workflow: { id: "alpha", revision: 1 },
      availableActions: expect.arrayContaining(["alpha_hold"]),
    });
    expect(tasks.find(({ id }) => id === second.id)).toMatchObject({
      workflow: { id: "beta", revision: 1 },
      availableActions: expect.not.arrayContaining(["beta_hold"]),
    });
    const context = await Effect.runPromise(
      createWorkflowReads(resolver, "mixed-host").workspace({ workspaceId, repoPath }),
    );
    expect(context.board.states.map(({ id }) => id)).toEqual([
      "alpha_queue",
      "beta_queue",
      "beta_work",
      "alpha_hold",
      "shared_review",
      "alpha_work",
      "beta_hold",
      "alpha_approval",
      "beta_approval",
      "shared_done",
      "alpha_shelved",
      "beta_shelved",
    ]);
    await expect(
      Effect.runPromise(
        service.applyTaskEvent({ workspaceId, repoPath, taskId: second.id, eventId: "beta_hold" }),
      ),
    ).rejects.toThrow("No action that sends beta_hold is available");
    const held = await Effect.runPromise(
      service.applyTaskEvent({ workspaceId, repoPath, taskId: first.id, eventId: "alpha_hold" }),
    );
    expect(held).toMatchObject({ status: "alpha_hold", workflow: { id: "alpha", revision: 1 } });
    await submit(first.id, "alpha_draft");
    await submit(first.id, "alpha_review", "accept");
    await submit(second.id, "beta_review", "accept");
    for (const task of [first, second]) {
      const result = await Effect.runPromise(
        service.applyTaskEvent({
          workspaceId,
          repoPath,
          taskId: task.id,
          eventId: `${task.workflow.id}_approve`,
        }),
      );
      expect(result.status).toBe("shared_done");
      expect(result.workflow).toEqual(task.workflow);
      const stored = await Effect.runPromise(
        harness.store.getTask({ workspaceId, repoPath, taskId: task.id }),
      );
      expect(stored).not.toHaveProperty("workflow");
      expect(stored).not.toHaveProperty("workflowSteps");
    }
  } finally {
    await harness.cleanup();
  }
});
