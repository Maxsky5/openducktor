import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Result } from "effect";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import type { WorkflowArtifactSaveInput } from "./task-inputs";
import {
  createAgentSessionRecord,
  createBuildSettingsConfig,
  createBuildWorkspaceSettingsService,
  createDirectMergeGitPort,
  createTaskService,
} from "./test-support/task-workflow-harness";

let harness: SqliteTaskStoreTestHarness;

beforeEach(async () => {
  harness = await createSqliteTaskStoreHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const service = () =>
  createTaskService({
    atomicTaskStore: harness.store,
    gitPort: createDirectMergeGitPort({
      calls: [],
      branches: { [harness.repoPath]: [{ name: "main", isCurrent: true, isRemote: false }] },
    }),
    settingsConfig: createBuildSettingsConfig(new Set([harness.repoPath]), harness.repoPath),
    taskActivityGuard: {
      countLiveSessions: () => Effect.succeed({ liveSessionCount: 0 }),
      cleanupTaskSessions: () => Effect.succeed({ stoppedSessionCount: 0 }),
    },
    workspaceSettingsService: createBuildWorkspaceSettingsService({
      ...harness.scope,
      hooks: { beforeWorktreeRemoval: [] },
    }),
  });

const moveTo = (taskId: string, status: string) =>
  Effect.runPromise(
    harness.store.transitionTask({
      ...harness.scope,
      taskId,
      decide: () => Result.succeed({ status, workflowId: "openducktor-spec-plan-build" }),
    }),
  );

const save = (taskId: string, code: string, updatedBy: string, verdict?: string) => {
  const input: WorkflowArtifactSaveInput = {
    ...harness.scope,
    taskId,
    code,
    markdown: `# ${code}`,
    submit: true,
    sourceTool: "odt_set_task_artifact",
    updatedBy,
  };
  if (verdict !== undefined) input.verdict = verdict;
  return Effect.runPromise(service().workflowArtifactSave(input));
};

const linkSession = (taskId: string, role: string) =>
  Effect.runPromise(
    harness.store.upsertAgentSession({
      ...harness.scope,
      taskId,
      ownershipScope: { catalogRevision: 0, workspaces: [harness.scope] },
      session: createAgentSessionRecord({
        externalSessionId: `session-${role}`,
        role,
        workingDirectory: harness.repoPath,
      }),
    }),
  );

/** A task in Human Review after an approved QA report, with the given planning artifacts. */
const reviewedTask = async (planning: readonly ("spec" | "plan")[]) => {
  const { id } = await Effect.runPromise(
    service().createTask({
      ...harness.scope,
      task: { title: "Reset me", issueType: "task", priority: 2 },
    }),
  );
  if (planning.includes("spec")) {
    await save(id, "spec", "spec");
    await linkSession(id, "spec");
  }
  if (planning.includes("plan")) {
    await save(id, "plan", "planner");
    await linkSession(id, "planner");
  }
  await moveTo(id, "in_progress");
  await linkSession(id, "build");
  await moveTo(id, "ai_review");
  await linkSession(id, "qa");
  await save(id, "qaReport", "qa", "approved");
  return id;
};

const resetImplementation = (taskId: string) =>
  Effect.runPromise(
    service().applyTaskEvent({ ...harness.scope, taskId, eventId: "reset-implementation" }),
  );

const storedState = async (taskId: string) => {
  const metadata = await Effect.runPromise(service().getTaskMetadata({ ...harness.scope, taskId }));
  return {
    artifacts: Object.keys(metadata.artifacts).sort(),
    sessionRoles: metadata.agentSessions.map(({ role }) => role).sort(),
  };
};

describe("reset implementation with the SQLite task store", () => {
  test("keeps the spec, the plan, and their sessions, and moves the task to Ready for Dev", async () => {
    const taskId = await reviewedTask(["spec", "plan"]);
    expect((await storedState(taskId)).artifacts).toEqual(["plan", "qaReport", "spec"]);

    const task = await resetImplementation(taskId);

    expect(task.status).toBe("ready_for_dev");
    expect(task.artifactSummary).toMatchObject({
      spec: { present: true },
      plan: { present: true },
      qaReport: { present: false },
    });
    expect(await storedState(taskId)).toEqual({
      artifacts: ["plan", "spec"],
      sessionRoles: ["planner", "spec"],
    });
  });

  test("moves a task with only a spec to Spec Ready", async () => {
    const taskId = await reviewedTask(["spec"]);

    const task = await resetImplementation(taskId);

    expect(task.status).toBe("spec_ready");
    expect(await storedState(taskId)).toEqual({ artifacts: ["spec"], sessionRoles: ["spec"] });
  });

  test("moves a task without planning artifacts to Backlog", async () => {
    const taskId = await reviewedTask([]);

    const task = await resetImplementation(taskId);

    expect(task.status).toBe("open");
    expect(await storedState(taskId)).toEqual({ artifacts: [], sessionRoles: [] });
  });
});
