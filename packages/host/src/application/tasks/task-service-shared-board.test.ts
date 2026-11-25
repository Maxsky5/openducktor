import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { TaskWorkflow } from "@openducktor/workflows";
import { createSharedBoardWorkflows } from "@openducktor/workflows/test-support";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import type {
  TaskWorkflowVersionCache,
  WorkspaceWorkflowPort,
} from "../../ports/task-workflow-port";
import { singleTaskWorkflow, testWorkspaceWorkflows } from "../../test-support/task-workflows";
import {
  createBuildSettingsConfig,
  createBuildStartGitPort,
  createBuildSystemCommands,
  createBuildWorkspaceSettingsService,
  createTaskService,
} from "./test-support/task-workflow-harness";

test("one workspace keeps mixed-workflow projections and mutations separate in shared states", async () => {
  const { alpha, beta } = createSharedBoardWorkflows();
  const byId = new Map([alpha, beta].map((workflow) => [workflow.reference.id, workflow]));
  const workflowOf = (workflowId: string) => {
    const workflow = byId.get(workflowId);
    if (!workflow) throw new Error(`No workflow ${workflowId}`);
    return workflow;
  };
  // Each task names its stored workflow. The test cache holds both versions.
  const resolver: TaskWorkflowVersionCache = {
    forTask: ({ workflowId }) => workflowOf(workflowId),
    forReference: ({ id }) => workflowOf(id),
    missing: () => [],
    cached: () => undefined,
    put: () => {},
    dropRole: () => {},
    dropWorkflow: () => {},
    noteTasks: () => {},
    forTaskId: () => undefined,
  };
  const workspaceWorkflows: WorkspaceWorkflowPort = {
    ...testWorkspaceWorkflows(singleTaskWorkflow(alpha)),
    newTaskWorkflow: (_scope, workflowId) => Effect.succeed(workflowOf(workflowId ?? "alpha")),
  };
  const harness = await createSqliteTaskStoreHarness({ taskWorkflows: resolver });
  const repoPath = harness.repoPath;
  const workspaceId = harness.workspaceId;
  const service = createTaskService({
    atomicTaskStore: harness.store,
    taskWorkflows: resolver,
    workspaceWorkflows,
    gitPort: createBuildStartGitPort({ calls: [] }),
    settingsConfig: createBuildSettingsConfig(new Set([repoPath])),
    systemCommands: createBuildSystemCommands([]),
    workspaceSettingsService: createBuildWorkspaceSettingsService({
      workspaceId: "fairnest",
      repoPath,
      hooks: { beforeWorktreeRemoval: [] },
    }),
  });
  const create = (workflow: TaskWorkflow) =>
    Effect.runPromise(
      service.createTask({
        workspaceId,
        repoPath,
        task: {
          title: workflow.definition.label,
          issueType: "feature",
          priority: 2,
          workflowId: workflow.reference.id,
        },
      }),
    );
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
      expect(result.status).toBe("closed");
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
