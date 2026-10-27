import { builtinTaskWorkflows, reviewTaskWorkflows } from "../../test-support/task-workflows";
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import {
  type AutopilotOutcome,
  type ExternalTaskSyncEvent,
  globalConfigSchema,
  repoConfigSchema,
} from "@openducktor/contracts";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { HostOperationError } from "../../effect/host-errors";
import { createTaskEventStream } from "../../events/task-event-stream";
import {
  createSettingsConfigTestDouble,
  createWorkspaceSettingsServiceTestDouble,
} from "../../test-support/service-test-doubles";
import { createEventPublishingTaskService } from "../tasks/event-publishing-task-service";
import { createTaskSyncService } from "../tasks/sync/task-sync-service";
import { noMergeDetection } from "../tasks/sync/task-sync-service.test-support";
import type { WorkflowArtifactSaveInput } from "../tasks/task-inputs";
import type { CommittedTaskStatusChange } from "../tasks/task-mutation-operation";
import { createTaskServiceWithMutationProgress } from "../tasks/task-service";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import { createAutopilotService, type AutopilotService } from "./autopilot-service";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("workflow commands through SQLite, publication, and Autopilot", () => {
  test("runs the feature flow, preserves artifact revisions, and distinguishes QA rejection from human changes", async () => {
    const workflow = await createWorkflowHarness();
    const input = await workflow.createTask("feature");
    const prematureBuild = await run(Effect.result(workflow.tasks.buildResumed(input)));
    expect(prematureBuild._tag).toBe("Failure");
    if (prematureBuild._tag === "Failure") {
      expect(prematureBuild.failure.message).toContain("Complete required planning");
    }
    await run(
      workflow.tasks.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...input,
        markdown: "# Draft",
        code: "spec",
        submit: false,
      }),
    );
    expect((await run(workflow.store.getTask(input))).status).toBe("open");
    expect(workflow.commits).toEqual([]);

    await run(
      workflow.tasks.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...input,
        markdown: "# Spec",
        code: "spec",
        submit: true,
      }),
    );
    await workflow.waitForOutcomes(1);
    await run(
      workflow.tasks.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...input,
        markdown: "# Plan",
        code: "plan",
        submit: true,
      }),
    );
    await workflow.waitForOutcomes(2);
    await run(workflow.tasks.buildResumed(input));
    await run(
      workflow.tasks.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...input,
        markdown: "# Revised spec",
        code: "spec",
        submit: true,
      }),
    );
    expect((await run(workflow.store.getTask(input))).status).toBe("in_progress");
    await run(workflow.tasks.buildCompleted(input));
    await workflow.waitForOutcomes(3);
    await run(workflow.tasks.buildCompleted(input));
    expect(workflow.hookCalls).toHaveLength(1);
    await run(
      workflow.tasks.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...input,
        markdown: "# Fix required",
        code: "qaReport",
        verdict: "rejected",
        submit: true,
      }),
    );
    await workflow.waitForOutcomes(4);
    await run(workflow.tasks.buildCompleted(input));
    await workflow.waitForOutcomes(5);
    await run(
      workflow.tasks.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...input,
        markdown: "# Approved",
        code: "qaReport",
        verdict: "approved",
        submit: true,
      }),
    );
    await workflow.waitForOutcomes(6);
    await run(workflow.tasks.humanRequestChanges(input));
    await run(workflow.tasks.buildCompleted(input));
    await workflow.waitForOutcomes(7);

    expect(workflow.actions).toEqual([
      "startPlanner",
      "startBuilder",
      "startQa",
      "startReviewQaFeedbacks",
      "startQa",
      "startGeneratePullRequest",
      "startGeneratePullRequest",
    ]);
    expect(
      workflow.commits.map(({ operation, signal, statusChange }) => [
        operation,
        signal,
        statusChange.previousStatus,
        statusChange.task.status,
      ]),
    ).toEqual([
      ["save-workflow-artifact", "taskProgressedToSpecReady", "open", "spec_ready"],
      ["save-workflow-artifact", "taskProgressedToReadyForDev", "spec_ready", "ready_for_dev"],
      ["build-resumed", undefined, "ready_for_dev", "in_progress"],
      ["build-completed", "taskProgressedToAiReview", "in_progress", "ai_review"],
      ["save-workflow-artifact", "taskRejectedByQa", "ai_review", "in_progress"],
      ["build-completed", "taskProgressedToAiReview", "in_progress", "ai_review"],
      ["save-workflow-artifact", "taskProgressedToHumanReview", "ai_review", "human_review"],
      ["human-request-changes", undefined, "human_review", "in_progress"],
      ["build-completed", "taskProgressedToHumanReview", "in_progress", "human_review"],
    ]);
    const metadata = await run(workflow.tasks.getTaskMetadata(input));
    expect(metadata.artifacts.spec).toMatchObject({ markdown: "# Revised spec", revision: 3 });
    expect(metadata.artifacts.plan).toMatchObject({ markdown: "# Plan", revision: 1 });
    expect(metadata.artifacts.qaReport).toMatchObject({
      markdown: "# Approved",
      revision: 2,
      verdict: "approved",
    });
    expect(workflow.hookCalls).toEqual(
      Array.from({ length: 3 }, () => ({
        command: "check-worktree",
        cwd: `/worktrees/workflow/${input.taskId}`,
      })),
    );
    expect(
      workflow.events
        .flatMap((event) => (event.kind === "tasks_updated" ? event.statusChanges : []))
        .filter((change) => change.sourceRole !== undefined)
        .map((change) => [change.sourceRole, change.task.status]),
    ).toEqual([
      ["qa", "human_review"],
      ["build", "human_review"],
    ]);
    expect(workflow.failures).toEqual([]);
  });

  test.each([
    ["spec", "startPlanner"],
    ["plan", "startBuilder"],
  ] as const)(
    "rolls back a %s whose status write fails, without an automatic handoff",
    async (section, action) => {
      const workflow = await createWorkflowHarness();
      const input = await workflow.createTask();
      const publications = workflow.events.length;
      const save = (markdown: string) =>
        workflow.tasks.workflowArtifactSave({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          ...input,
          markdown,
          code: section,
          submit: true,
        });
      workflow.executeSql(
        "CREATE TRIGGER reject_status BEFORE UPDATE OF status ON tasks WHEN NEW.status != OLD.status BEGIN SELECT RAISE(ABORT, 'Status write rejected'); END",
      );
      const result = await run(Effect.result(save("# Rejected document")));
      expect(result._tag).toBe("Failure");
      expect((await run(workflow.store.getTask(input))).status).toBe("open");
      expect((await run(workflow.tasks.getTaskMetadata(input))).artifacts[section]).toBeUndefined();
      expect(workflow.commits).toEqual([]);
      expect(workflow.actions).toEqual([]);
      expect(workflow.events).toHaveLength(publications);
      workflow.executeSql("DROP TRIGGER reject_status");
      await run(save("# Finished document"));
      await workflow.waitForOutcomes(1);
      expect(workflow.actions).toEqual([action]);
      expect((await run(workflow.tasks.getTaskMetadata(input))).artifacts[section]).toMatchObject({
        markdown: "# Finished document",
        revision: 1,
      });
    },
  );

  test("runs the automations of a custom workflow for its signals", async () => {
    const workflow = await createWorkflowHarness({
      taskWorkflows: reviewTaskWorkflows,
      rules: [
        { eventId: "draftSubmitted", actionIds: ["startEditor"] },
        { eventId: "reviewRejected", actionIds: ["startRevision"] },
      ],
    });
    const input = await workflow.createTask("article");
    const save = (code: string, updatedBy: string, verdict?: string) => {
      const save: WorkflowArtifactSaveInput = {
        ...input,
        code,
        markdown: `# ${code}`,
        submit: true,
        sourceTool: "odt_set_task_artifact",
        updatedBy,
      };
      if (verdict !== undefined) save.verdict = verdict;
      return run(workflow.tasks.workflowArtifactSave(save));
    };
    await run(workflow.tasks.transitionTask({ ...input, status: "writing" }));
    await save("draft", "writer");
    await workflow.waitForOutcomes(1);
    await save("review", "editor", "revise");
    await workflow.waitForOutcomes(2);
    await save("draft", "writer");
    await workflow.waitForOutcomes(3);
    await save("review", "editor", "accept");

    expect(workflow.actions).toEqual(["startEditor", "startRevision", "startEditor"]);
    expect(
      workflow.commits.map(({ operation, signal, statusChange }) => [
        operation,
        signal,
        statusChange.previousStatus,
        statusChange.task.status,
      ]),
    ).toEqual([
      ["transition-task", undefined, "backlog", "writing"],
      ["save-workflow-artifact", "draftSubmitted", "writing", "reviewing"],
      ["save-workflow-artifact", "reviewRejected", "reviewing", "writing"],
      ["save-workflow-artifact", "draftSubmitted", "writing", "reviewing"],
      ["save-workflow-artifact", "reviewAccepted", "reviewing", "approval"],
    ]);
    expect(
      workflow.events
        .flatMap((event) => (event.kind === "tasks_updated" ? event.statusChanges : []))
        .filter((change) => change.sourceRole !== undefined)
        .map((change) => [change.sourceRole, change.task.status]),
    ).toEqual([["editor", "approval"]]);
    expect(workflow.failures).toEqual([]);
  });

  test("rolls back a failed QA report and keeps the AI review status", async () => {
    const workflow = await createWorkflowHarness();
    const input = await workflow.createTask();
    await run(workflow.tasks.buildResumed(input));
    await run(workflow.tasks.buildCompleted(input));
    await workflow.waitForOutcomes(1);
    expect((await run(workflow.store.getTask(input))).status).toBe("ai_review");
    const commits = workflow.commits.length;
    const publications = workflow.events.length;
    workflow.executeSql(
      "CREATE TRIGGER reject_qa BEFORE INSERT ON tasks_artifacts WHEN NEW.code = 'qaReport' BEGIN SELECT RAISE(ABORT, 'Report write rejected'); END",
    );
    expect(
      (
        await run(
          Effect.result(
            workflow.tasks.workflowArtifactSave({
              sourceTool: "workflow_artifact_save",
              updatedBy: "user",
              ...input,
              markdown: "# Rejected",
              code: "qaReport",
              verdict: "rejected",
              submit: true,
            }),
          ),
        )
      )._tag,
    ).toBe("Failure");
    expect(await run(workflow.store.getTask(input))).toMatchObject({
      status: "ai_review",
      artifactSummary: { qaReport: { present: false } },
    });
    expect(workflow.commits).toHaveLength(commits);
    expect(workflow.events).toHaveLength(publications);
    workflow.executeSql("DROP TRIGGER reject_qa");
    await run(
      workflow.tasks.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...input,
        markdown: "# Rejected",
        code: "qaReport",
        verdict: "rejected",
        submit: true,
      }),
    );
    await workflow.waitForOutcomes(2);
    expect(await run(workflow.store.getTask(input))).toMatchObject({
      status: "in_progress",
      artifactSummary: { qaReport: { present: true, verdict: "rejected" } },
    });
    expect(workflow.actions).toEqual(["startQa", "startReviewQaFeedbacks"]);
    expect(
      await run(workflow.tasks.workflowArtifactGet({ ...input, code: "qaReport" })),
    ).toMatchObject({
      markdown: "# Rejected",
      revision: 1,
    });
  });

  test("commits and publishes a blocked build when its completion hook fails, then completes once", async () => {
    const workflow = await createWorkflowHarness();
    const input = await workflow.createTask();
    await run(workflow.tasks.buildResumed(input));
    workflow.setHookSucceeds(false);
    const failed = await run(Effect.result(workflow.tasks.buildCompleted(input)));
    expect(failed._tag).toBe("Failure");
    if (failed._tag === "Failure") expect(failed.failure.message).toContain("Hook failed");
    expect((await run(workflow.store.getTask(input))).status).toBe("blocked");
    expect(workflow.commits.at(-1)).toMatchObject({
      operation: "build-completed",
      statusChange: { previousStatus: "in_progress", task: { status: "blocked" } },
    });
    expect(workflow.events.at(-1)).toMatchObject({
      statusChanges: [{ previousStatus: "in_progress", task: { status: "blocked" } }],
    });
    expect(workflow.actions).toEqual([]);
    workflow.setHookSucceeds(true);
    await run(workflow.tasks.buildCompleted(input));
    await workflow.waitForOutcomes(1);
    await run(workflow.tasks.buildCompleted(input));
    expect(workflow.hookCalls).toHaveLength(2);
    expect(workflow.actions).toEqual(["startQa"]);
    expect(workflow.commits.at(-1)).toMatchObject({
      operation: "build-completed",
      statusChange: { previousStatus: "blocked", task: { status: "ai_review" } },
    });
  });

  test.each(["failure", "interruption"] as const)(
    "keeps a committed completion and hands off once after publication %s",
    async (mode) => {
      const workflow = await createWorkflowHarness();
      const input = await workflow.createTask();
      await run(workflow.tasks.buildResumed(input));
      const entered = Deferred.makeUnsafe<void>();
      workflow.setPublicationGate(
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(
            mode === "failure"
              ? Effect.fail(
                  new HostOperationError({
                    operation: "test.snapshot",
                    message: "Snapshot unavailable",
                  }),
                )
              : Effect.never,
          ),
        ),
      );
      const publicationCount = workflow.events.length;
      const fiber = Effect.runFork(workflow.tasks.buildCompleted(input));
      await run(Deferred.await(entered));
      if (mode === "interruption") {
        expect(workflow.actions).toEqual([]);
        await run(Fiber.interrupt(fiber));
      }
      const result = await run(Fiber.await(fiber));
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        if (mode === "interruption") expect(Cause.hasInterruptsOnly(result.cause)).toBe(true);
        else
          expect(Cause.squash(result.cause)).toMatchObject({
            message: expect.stringContaining("Do not repeat the change"),
          });
      }
      await workflow.waitForOutcomes(1);
      expect((await run(workflow.store.getTask(input))).status).toBe("ai_review");
      expect(workflow.events).toHaveLength(publicationCount);
      expect(workflow.actions).toEqual(["startQa"]);
      expect(workflow.failures).toHaveLength(mode === "failure" ? 1 : 0);
      workflow.setPublicationGate(Effect.void);
      await run(workflow.tasks.buildCompleted(input));
      expect(workflow.hookCalls).toHaveLength(1);
      expect(
        workflow.commits.filter((change) => change.operation === "build-completed"),
      ).toHaveLength(1);
      expect(workflow.events.at(-1)).toMatchObject({ statusChanges: [] });
      expect(workflow.actions).toEqual(["startQa"]);
    },
  );
});

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

/** Keep real SQLite writes and publication so the tests can observe failures after commit. */
const builtinRules = [
  { eventId: "taskProgressedToSpecReady", actionIds: ["startPlanner"] },
  { eventId: "taskProgressedToReadyForDev", actionIds: ["startBuilder"] },
  { eventId: "taskProgressedToAiReview", actionIds: ["startQa"] },
  { eventId: "taskRejectedByQa", actionIds: ["startReviewQaFeedbacks"] },
  { eventId: "taskProgressedToHumanReview", actionIds: ["startGeneratePullRequest"] },
];

const createWorkflowHarness = async ({
  taskWorkflows = builtinTaskWorkflows,
  rules = builtinRules,
}: {
  readonly taskWorkflows?: TaskWorkflowResolver;
  readonly rules?: ReadonlyArray<{ eventId: string; actionIds: string[] }>;
} = {}) => {
  const fixture = await createSqliteTaskStoreHarness({
    repoPath: "/repos/workflow",
    taskWorkflows,
    workspaceId: "workflow",
  });
  const { repoPath, store } = fixture;
  const repo = repoConfigSchema.parse({
    workspaceId: "workflow",
    workspaceName: "Workflow",
    repoPath,
    hooks: { postComplete: ["check-worktree"] },
  });
  const config = globalConfigSchema.parse({
    version: 4,
    workspaces: { workflow: repo },
    autopilot: { rules },
  });
  const settingsConfig = createSettingsConfigTestDouble({
    readConfig: () => Effect.succeed(config),
    pathExists: () => Effect.succeed(true),
    canonicalizePath: (path) => Effect.succeed(path),
    defaultWorktreeBasePath: () => "/worktrees/workflow",
    join: (...parts) => parts.join("/"),
  });
  let publicationGate: Effect.Effect<void, HostOperationError> = Effect.void;
  let hookSucceeds = true;
  const hookCalls: Array<{ command: string; cwd: string | undefined }> = [];
  const workspaceSettingsService = createWorkspaceSettingsServiceTestDouble({
    getRepoConfigByRepoPath: () => Effect.succeed(repo),
    getSettingsSnapshot: () => publicationGate.pipe(Effect.as(config)),
  });
  const taskService = createTaskServiceWithMutationProgress({
    taskWorkflows,
    taskStore: store,
    settingsConfig,
    workspaceSettingsService,
    systemCommands: {
      resolveCommandPath: (command) => Effect.succeed(command),
      versionCommand: () => Effect.die(new Error("Unexpected version command")),
      runCommandAllowFailure: (command, _args, options) =>
        Effect.sync(() => {
          hookCalls.push({ command, cwd: options?.cwd });
          return { ok: hookSucceeds, stdout: "", stderr: hookSucceeds ? "" : "Hook failed" };
        }),
    },
  });
  const events: ExternalTaskSyncEvent[] = [];
  const failures: unknown[] = [];
  const commits: CommittedTaskStatusChange[] = [];
  const stream = createTaskEventStream({
    reporter: { report: (failure) => failures.push(failure) },
  });
  let autopilot: AutopilotService;
  const taskSyncService = createTaskSyncService({
    taskService,
    workspaceSettingsService,
    mergeDetection: noMergeDetection,
    taskEventStream: {
      ...stream,
      publish: (event) => {
        const cursor = stream.publish(event);
        events.push(event);
        return cursor;
      },
    },
    publicationReporter: {
      report: (failure) => Effect.sync(() => void failures.push(failure)),
    },
    onBackgroundFailure: (failure) => Effect.sync(() => void failures.push(failure)),
    observeStatusChanges: (change) => {
      commits.push(change);
      autopilot.observe(change);
    },
  });
  const tasks = createEventPublishingTaskService({
    taskWorkflows,
    taskService,
    taskSyncService,
  });
  const actions: string[] = [];
  const outcomes: AutopilotOutcome[] = [];
  autopilot = createAutopilotService({
    taskWorkflows,
    settingsConfig,
    tasks,
    mutations: taskSyncService,
    workflowLaunch: {
      launch: (request) =>
        Effect.gen(function* () {
          const policy = request.policy;
          if (policy.kind !== "automatic") return yield* Effect.die(new Error("Manual launch"));
          const result = {
            workspaceId: request.workspaceId,
            repoPath: request.repoPath,
            taskId: request.taskId,
            role: taskWorkflows.forTask({ id: request.taskId }).automation(policy.actionId).role,
          };
          const check = yield* policy.startCheck;
          if (!check.start) return { ...result, status: "skipped", skipReason: check.reason };
          actions.push(policy.actionId);
          return { ...result, status: "completed" };
        }),
    },
    notifications: {
      publishAction: () => Effect.die(new Error("A launch without a session cannot notify")),
    },
    publish: (event) => {
      if (event.type === "autopilot_outcome") outcomes.push(event.outcome);
    },
    onBackgroundFailure: (failure) => Effect.sync(() => void failures.push(failure)),
  });
  cleanups.push(async () => {
    await run(autopilot.dispose());
    await fixture.cleanup();
  });
  await run(autopilot.initialize());
  return {
    ...fixture,
    tasks,
    events,
    failures,
    commits,
    actions,
    outcomes,
    hookCalls,
    setHookSucceeds: (value: boolean) => {
      hookSucceeds = value;
    },
    setPublicationGate: (gate: typeof publicationGate) => {
      publicationGate = gate;
    },
    createTask: async (issueType = "task") => {
      const task = await run(
        tasks.createTask({
          repoPath,
          task: { title: "Workflow", issueType, priority: 2 },
        }),
      );
      return { repoPath, taskId: task.id };
    },
    waitForOutcomes: async (count: number) => {
      for (let turn = 0; turn < 500; turn++) {
        if (outcomes.length >= count) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error(`Expected ${count} Autopilot outcomes, received ${outcomes.length}`);
    },
    executeSql: (sql: string) => {
      const database = new Database(fixture.databasePath);
      try {
        database.run(sql);
      } finally {
        database.close();
      }
    },
  };
};
