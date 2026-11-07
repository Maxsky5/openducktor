import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { workflowDefinitionSchema } from "@openducktor/contracts";
import { BUILTIN_ROLES, createTaskWorkflow, specPlanBuildWorkflow } from "@openducktor/workflows";
import { Effect, Result } from "effect";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import { builtinTaskWorkflows, singleTaskWorkflow } from "../../test-support/task-workflows";
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
  options = {};
  await harness.cleanup();
});

type ServiceOptions = {
  readonly taskWorkflows?: TaskWorkflowResolver;
  /** Runs when the reset stops the task sessions, after the host admitted the event. */
  readonly onSessionCleanup?: () => Promise<void>;
};

let options: ServiceOptions = {};

const service = () =>
  createTaskService({
    atomicTaskStore: harness.store,
    taskWorkflows: options.taskWorkflows ?? builtinTaskWorkflows,
    gitPort: createDirectMergeGitPort({
      calls: [],
      branches: { [harness.repoPath]: [{ name: "main", isCurrent: true, isRemote: false }] },
    }),
    settingsConfig: createBuildSettingsConfig(new Set([harness.repoPath]), harness.repoPath),
    taskActivityGuard: {
      countLiveSessions: () => Effect.succeed({ liveSessionCount: 0 }),
      cleanupTaskSessions: () =>
        Effect.promise(async () => {
          await options.onSessionCleanup?.();
          return { stoppedSessionCount: 0 };
        }),
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

/** The built-in workflow, with a reset that needs the QA report that the reset itself clears. */
const qaReportResetWorkflows = (): TaskWorkflowResolver => {
  const definition = workflowDefinitionSchema.parse(specPlanBuildWorkflow.definition);
  const reset = definition.events.find(({ id }) => id === "reset-implementation");
  if (!reset) throw new Error("The built-in workflow has no reset-implementation event.");
  reset.guards = [
    {
      id: "qa-reviewed",
      when: { artifact: "qaReport", present: true },
      message: "Save a QA report first",
    },
  ];
  return singleTaskWorkflow(
    createTaskWorkflow(definition, specPlanBuildWorkflow.workflowTemplates, BUILTIN_ROLES),
  );
};

describe("reset implementation whose guard needs a review artifact", () => {
  beforeEach(async () => {
    const taskWorkflows = qaReportResetWorkflows();
    await harness.cleanup();
    harness = await createSqliteTaskStoreHarness({ taskWorkflows });
    options = { taskWorkflows };
  });

  test("commits the admitted reset after the reset clears the QA report", async () => {
    const taskId = await reviewedTask([]);

    const task = await resetImplementation(taskId);

    expect(task.status).toBe("open");
    expect(task.artifactSummary).toMatchObject({ qaReport: { present: false } });
    expect(await storedState(taskId)).toEqual({ artifacts: [], sessionRoles: [] });
  });

  test("does not commit when another change moves the task while the reset runs", async () => {
    const taskId = await reviewedTask([]);
    options = {
      ...options,
      onSessionCleanup: async () => {
        await moveTo(taskId, "ai_review");
      },
    };

    const exit = await Effect.runPromiseExit(
      service().applyTaskEvent({ ...harness.scope, taskId, eventId: "reset-implementation" }),
    );

    expect(String(exit)).toContain(
      `Another change moved task ${taskId} from human_review to ai_review while reset-implementation ran its host effects, so reset-implementation did not commit. Check the task, then apply reset-implementation again if it still applies.`,
    );
    const card = await Effect.runPromise(service().findTask({ ...harness.scope, taskId }));
    expect(card?.status).toBe("ai_review");
  });
});
