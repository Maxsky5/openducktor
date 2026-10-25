import { builtinTaskWorkflow } from "@openducktor/workflows";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { afterEach, describe, expect, test } from "bun:test";
import {
  type AutopilotOutcome,
  type AutopilotRunEvent,
  autopilotStateSchema,
  type GlobalConfig,
  globalConfigSchema,
  type HostEventEnvelope,
  type NotificationActionOccurrence,
  repoConfigSchema,
  type WorkflowLaunchResult,
} from "@openducktor/contracts";
import {
  type BuiltinTaskEventId,
  getAutopilotAction,
  workflowArtifactSubmitEvent,
  createBuiltinNotificationSettings,
} from "@openducktor/workflows";
import { Deferred, Effect, Fiber } from "effect";
import { withConfigCommit } from "../../adapters/config/config-commit";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import { type HostError, HostOperationError } from "../../effect/host-errors";
import { createHostEventBus } from "../../events/host-event-bus";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { TaskRecord, TaskStorePort } from "../../ports/task-repository-ports";
import { createSettingsConfigTestDouble } from "../../test-support/service-test-doubles";
import { createTaskServiceWithMutationProgressTestDouble } from "../../test-support/task-service-test-double";
import type { AutomaticLaunchInput } from "../agent-sessions/test-support/workflow-launch-harness";
import { createSerialGate } from "../../effect/serial-gate";
import { createEventPublishingTaskService } from "../tasks/event-publishing-task-service";
import { enrichTask, enrichTasks } from "../tasks/support/task-workflow-helpers";
import { createTaskSyncService } from "../tasks/sync/task-sync-service";
import { type AutopilotService, createAutopilotService } from "./autopilot-service";

const ALL_RULES: Array<{ eventId: string; actionIds: string[] }> = [
  { eventId: "taskProgressedToSpecReady", actionIds: ["startPlanner"] },
  { eventId: "taskProgressedToReadyForDev", actionIds: ["startBuilder"] },
  { eventId: "taskProgressedToAiReview", actionIds: ["startQa"] },
  { eventId: "taskRejectedByQa", actionIds: ["startReviewQaFeedbacks"] },
  { eventId: "taskProgressedToHumanReview", actionIds: ["startGeneratePullRequest"] },
];

const configFor = (
  rules: typeof ALL_RULES,
  workspaces: Record<string, { closed?: boolean; removal?: boolean }> = {},
): GlobalConfig =>
  globalConfigSchema.parse({
    version: 4,
    autopilot: { rules },
    workspaces: Object.fromEntries(
      ["alpha", "beta"].map((id) => {
        const repo = repoConfigSchema.parse({
          workspaceId: id,
          workspaceName: id === "alpha" ? "Alpha" : "Beta",
          repoPath: `/repos/${id}`,
        });
        if (workspaces[id]?.closed) repo.closed = true;
        if (workspaces[id]?.removal)
          repo.removal = {
            removeTaskWorktrees: false,
            phase: "worktrees",
            pendingWorktreePath: null,
          };
        return [id, repo];
      }),
    ),
  });

const session = {
  externalSessionId: "session-1",
  runtimeKind: "codex" as const,
  workingDirectory: "/worktrees/task",
  startedAt: "2026-10-10T00:00:00.000Z",
  status: "idle" as const,
};

const launchResult = (
  request: AutomaticLaunchInput,
  patch: Partial<WorkflowLaunchResult> = {},
): WorkflowLaunchResult => ({
  workspaceId: request.workspaceId,
  repoPath: request.repoPath,
  taskId: request.taskId,
  role: getAutopilotAction(request.policy.actionId).role,
  status: "completed",
  ...patch,
});

// Effect runs each scheduled fiber step in a setImmediate callback.
const waitUntil = async (condition: () => boolean, label: string): Promise<void> => {
  for (let turn = 0; turn < 500; turn++) {
    if (condition()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};
const settleFibers = async (): Promise<void> => {
  for (let turn = 0; turn < 50; turn++) await new Promise<void>((resolve) => setImmediate(resolve));
};

const harnesses: SqliteTaskStoreTestHarness[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.cleanup()));
});

const createAutopilotHarness = async ({
  rules = ALL_RULES,
  stores,
}: {
  rules?: typeof ALL_RULES;
  stores?: Map<string, TaskStorePort>;
} = {}) => {
  let taskStores = stores;
  if (!taskStores) {
    const created = await Promise.all(
      ["alpha", "beta"].map((id) =>
        createSqliteTaskStoreHarness({ repoPath: `/repos/${id}`, workspaceId: id }),
      ),
    );
    harnesses.push(...created);
    taskStores = new Map(created.map((harness) => [harness.repoPath, harness.store]));
  }
  const storeMap = taskStores;
  const store = (repoPath: string): TaskStorePort => {
    const found = storeMap.get(repoPath);
    if (!found) throw new Error(`No test task store for ${repoPath}.`);
    return found;
  };
  let publicationGate: Effect.Effect<void, HostOperationError> = Effect.void;
  // Pauses build completion after its commit, before the mutation returns.
  let afterCommitGate: Effect.Effect<void> = Effect.void;
  let taskIdsGate: Effect.Effect<void> = Effect.void;
  let buildCompletedStatus: string = "ai_review";
  const move = (status: string) => (input: { repoPath: string; taskId: string }) =>
    store(input.repoPath)
      .transitionTask({ repoPath: input.repoPath, taskId: input.taskId, status })
      .pipe(Effect.map((task) => enrichTask(builtinTaskWorkflow, task)));
  // Each operation commits the workflow decision of its event, with the signal of its outcome.
  const decided =
    (eventId: BuiltinTaskEventId, prepare: (task: TaskRecord) => TaskRecord = (task) => task) =>
    (input: { repoPath: string; taskId: string }) =>
      store(input.repoPath)
        .getTask(input)
        .pipe(
          Effect.flatMap((task) => {
            const decision = builtinTaskWorkflow.decide(eventId, prepare(task));
            if (decision.kind !== "transition") return Effect.succeed(task);
            return store(input.repoPath).transitionTask({
              repoPath: input.repoPath,
              taskId: input.taskId,
              status: decision.to,
              cause: decision.cause,
            });
          }),
          Effect.map((task) => enrichTask(builtinTaskWorkflow, task)),
        );
  const withApprovedQa = (task: TaskRecord): TaskRecord =>
    buildCompletedStatus === "human_review"
      ? {
          ...task,
          artifactSummary: {
            ...task.artifactSummary,
            qaReport: { present: true, verdict: "approved" },
          },
        }
      : task;
  const base = createTaskServiceWithMutationProgressTestDouble({
    // Publication reads a task snapshot, so the gate pauses an operation after its commit.
    listTasks: (input) =>
      publicationGate.pipe(
        Effect.andThen(store(input.repoPath).listTasks(input)),
        Effect.map((tasks) => enrichTasks(builtinTaskWorkflow, tasks)),
      ),
    listTaskIds: (input) =>
      taskIdsGate.pipe(Effect.andThen(store(input.repoPath).listTaskIds(input))),
    workflowArtifactSave: (input) => {
      const eventId = workflowArtifactSubmitEvent(input.code, input.verdict);
      if (eventId === undefined) throw new Error(`No test event for ${input.code}.`);
      return decided(eventId)(input).pipe(
        Effect.as({
          artifact: { markdown: input.markdown },
          changes: { taskIds: [input.taskId], removedTaskIds: [] },
        }),
      );
    },
    buildCompleted: (input) =>
      decided("build-completed", withApprovedQa)(input).pipe(Effect.tap(() => afterCommitGate)),
    buildBlocked: decided("build-blocked"),
    buildResumed: decided("build-resumed"),
    humanRequestChanges: decided("human-request-changes"),
    resetImplementation: move("ready_for_dev"),
    transitionTask: (input) => move(input.status)(input),
    deleteTask: (input) =>
      store(input.repoPath)
        .deleteTask({ repoPath: input.repoPath, taskId: input.taskId })
        .pipe(
          Effect.as({
            ok: true,
            changes: { taskIds: [input.taskId], removedTaskIds: [input.taskId] },
          }),
        ),
  });
  const backgroundFailures: HostError[] = [];
  let autopilot: AutopilotService | undefined;
  let saved = configFor(rules);
  const sync = createTaskSyncService({
    taskService: base,
    taskEventStream: {
      publish: () => ({ epoch: "11111111-1111-4111-8111-111111111111", sequence: 1 }),
      subscribe: () => {
        throw new Error("Unexpected subscription");
      },
      acknowledge: () => {
        throw new Error("Unexpected acknowledgement");
      },
    },
    publicationReporter: { report: () => Effect.void },
    onBackgroundFailure: (failure) =>
      Effect.sync(() => {
        backgroundFailures.push(failure);
      }),
    workspaceSettingsService: {
      getWorkspaceCatalog: () =>
        Effect.succeed({ openWorkspaces: [], closedWorkspaces: [], incompleteRemovals: [] }),
      getSettingsSnapshot: () => Effect.succeed(saved),
      listWorkspaces: () => Effect.succeed([]),
    },
    observeStatusChanges: (changes) => autopilot?.observe(changes),
  });
  const tasks = createEventPublishingTaskService({
    taskWorkflows: builtinTaskWorkflows,
    taskService: base,
    taskSyncService: sync,
  });

  let readFailure: HostOperationError | null = null;
  const settingsConfig: SettingsConfigPort = withConfigCommit(
    createSettingsConfigTestDouble({
      readConfig: () => (readFailure ? Effect.fail(readFailure) : Effect.succeed(saved)),
      writeConfig: (next) =>
        Effect.sync(() => {
          saved = next;
        }),
    }),
    (config) => (autopilot ? autopilot.configCommitted(config) : Effect.void),
  );

  const launched: AutomaticLaunchInput[] = [];
  const launchLanes = createSerialGate();
  let launchGate: Effect.Effect<void> = Effect.void;
  let respond = (request: AutomaticLaunchInput): Effect.Effect<WorkflowLaunchResult, HostError> =>
    Effect.succeed(launchResult(request, { session, startMode: "fresh" }));
  const notifications: NotificationActionOccurrence[] = [];
  let notificationFailure: HostOperationError | null = null;
  const eventBus = createHostEventBus({ report: () => {} });
  const runEvents: AutopilotRunEvent[] = [];
  eventBus.subscribe("openducktor://run-event", (envelope) => {
    if (envelope.channel === "openducktor://run-event") runEvents.push(envelope.payload);
  });

  const start = () => {
    autopilot = createAutopilotService({
      taskWorkflows: builtinTaskWorkflows,
      settingsConfig,
      tasks,
      mutations: sync,
      workflowLaunch: {
        // Like the launch lane: launches of one task run in arrival order, and each runs its start
        // check first.
        launch: (request) =>
          launchLanes.run(
            request.taskId,
            Effect.gen(function* () {
              if (request.policy.kind !== "automatic")
                return yield* Effect.die(new Error("Autopilot sent a manual launch."));
              const { startCheck, ...policy } = request.policy;
              const automatic: AutomaticLaunchInput = { ...request, policy };
              yield* launchGate;
              const check = yield* startCheck;
              if (!check.start)
                return launchResult(automatic, { status: "skipped", skipReason: check.reason });
              launched.push(automatic);
              return yield* respond(automatic);
            }),
          ),
      },
      notifications: {
        publishAction: (occurrence) =>
          Effect.suspend(() => {
            if (notificationFailure) return Effect.fail(notificationFailure);
            notifications.push(occurrence);
            return Effect.succeed({
              occurrence,
              settings: createBuiltinNotificationSettings(),
              preferenceRevision: 0,
            });
          }),
      },
      publish: (event) => eventBus.publish({ channel: "openducktor://run-event", payload: event }),
      onBackgroundFailure: (failure) =>
        Effect.sync(() => {
          backgroundFailures.push(failure);
        }),
    });
    return autopilot;
  };
  const service = (): AutopilotService => {
    if (!autopilot) throw new Error("Start Autopilot first.");
    return autopilot;
  };
  const createTask = async (repoPath: string, status: string, title = "Task") => {
    const task = await Effect.runPromise(
      store(repoPath).createTask({
        repoPath,
        status: "open",
        task: { title, issueType: "task", priority: 2 },
      }),
    );
    if (status !== "open")
      await Effect.runPromise(
        store(repoPath).transitionTask({ repoPath, taskId: task.id, status }),
      );
    return task.id;
  };
  const outcomes = (): AutopilotOutcome[] =>
    runEvents.flatMap((event) => (event.type === "autopilot_outcome" ? [event.outcome] : []));

  return {
    tasks,
    sync,
    stores: storeMap,
    eventBus,
    start,
    service,
    createTask,
    launched,
    notifications,
    runEvents,
    outcomes,
    backgroundFailures,
    saveConfig: (config: GlobalConfig) => Effect.runPromise(settingsConfig.writeConfig(config)),
    setPublicationGate: (gate: Effect.Effect<void, HostOperationError>) => {
      publicationGate = gate;
    },
    setLaunchGate: (gate: Effect.Effect<void>) => {
      launchGate = gate;
    },
    setAfterCommitGate: (gate: Effect.Effect<void>) => {
      afterCommitGate = gate;
    },
    setTaskIdsGate: (gate: Effect.Effect<void>) => {
      taskIdsGate = gate;
    },
    setRespond: (next: typeof respond) => {
      respond = next;
    },
    setBuildCompletedStatus: (status: string) => {
      buildCompletedStatus = status;
    },
    setReadFailure: (failure: HostOperationError) => {
      readFailure = failure;
    },
    setNotificationFailure: (failure: HostOperationError) => {
      notificationFailure = failure;
    },
  };
};

type Harness = Awaited<ReturnType<typeof createAutopilotHarness>>;

const startedHarness = async (options?: Parameters<typeof createAutopilotHarness>[0]) => {
  const h = await createAutopilotHarness(options);
  await Effect.runPromise(h.start().initialize());
  return h;
};

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const actionsOf = (h: Harness) => h.launched.map((request) => request.policy.actionId);

describe("host Autopilot", () => {
  const plan = (repoPath: string, taskId: string) => ({
    repoPath,
    taskId,
    code: "plan",
    markdown: "# Plan",
    submit: true,
    sourceTool: "workflow_artifact_save",
    updatedBy: "user",
  });
  test.each<{
    name: string;
    from: string;
    to: string;
    mutate: (h: Harness, taskId: string) => Effect.Effect<unknown, unknown>;
    eventId: string;
    actionId: string;
    role: string;
  }>([
    {
      name: "a spec save from Backlog",
      from: "open",
      to: "spec_ready",
      mutate: (h: Harness, taskId: string) =>
        h.tasks.workflowArtifactSave({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          repoPath: "/repos/alpha",
          taskId,
          code: "spec",
          markdown: "# Spec",
          submit: true,
        }),
      eventId: "taskProgressedToSpecReady",
      actionId: "startPlanner",
      role: "planner",
    },
    {
      name: "a plan save from Backlog",
      from: "open",
      to: "ready_for_dev",
      mutate: (h: Harness, taskId: string) =>
        h.tasks.workflowArtifactSave(plan("/repos/alpha", taskId)),
      eventId: "taskProgressedToReadyForDev",
      actionId: "startBuilder",
      role: "build",
    },
    {
      name: "a plan save from Spec Ready",
      from: "spec_ready",
      to: "ready_for_dev",
      mutate: (h: Harness, taskId: string) =>
        h.tasks.workflowArtifactSave(plan("/repos/alpha", taskId)),
      eventId: "taskProgressedToReadyForDev",
      actionId: "startBuilder",
      role: "build",
    },
    {
      name: "a build completion to AI Review",
      from: "in_progress",
      to: "ai_review",
      mutate: (h: Harness, taskId: string) =>
        h.tasks.buildCompleted({ repoPath: "/repos/alpha", taskId }),
      eventId: "taskProgressedToAiReview",
      actionId: "startQa",
      role: "qa",
    },
    {
      name: "a QA rejection from AI Review",
      from: "ai_review",
      to: "in_progress",
      mutate: (h: Harness, taskId: string) =>
        h.tasks.workflowArtifactSave({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          repoPath: "/repos/alpha",
          taskId,
          markdown: "Rejected",
          code: "qaReport",
          verdict: "rejected",
          submit: true,
        }),
      eventId: "taskRejectedByQa",
      actionId: "startReviewQaFeedbacks",
      role: "build",
    },
    {
      name: "a QA rejection from Blocked",
      from: "blocked",
      to: "in_progress",
      mutate: (h: Harness, taskId: string) =>
        h.tasks.workflowArtifactSave({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          repoPath: "/repos/alpha",
          taskId,
          markdown: "Rejected",
          code: "qaReport",
          verdict: "rejected",
          submit: true,
        }),
      eventId: "taskRejectedByQa",
      actionId: "startReviewQaFeedbacks",
      role: "build",
    },
    {
      name: "a QA approval",
      from: "ai_review",
      to: "human_review",
      mutate: (h: Harness, taskId: string) =>
        h.tasks.workflowArtifactSave({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          repoPath: "/repos/alpha",
          taskId,
          markdown: "Approved",
          code: "qaReport",
          verdict: "approved",
          submit: true,
        }),
      eventId: "taskProgressedToHumanReview",
      actionId: "startGeneratePullRequest",
      role: "build",
    },
    {
      name: "a build completion to Human Review",
      from: "in_progress",
      to: "human_review",
      mutate: (h: Harness, taskId: string) =>
        h.tasks.buildCompleted({ repoPath: "/repos/alpha", taskId }),
      eventId: "taskProgressedToHumanReview",
      actionId: "startGeneratePullRequest",
      role: "build",
    },
  ])("$name starts $actionId once", async ({ from, to, mutate, eventId, actionId, role }) => {
    const h = await startedHarness();
    h.setBuildCompletedStatus(to);
    const taskId = await h.createTask("/repos/alpha", from, "Ship it");
    await run(mutate(h, taskId));
    await waitUntil(() => h.outcomes().length === 1, "the outcome");

    expect(h.launched).toEqual([
      {
        workspaceId: "alpha",
        repoPath: "/repos/alpha",
        taskId,
        policy: { kind: "automatic", actionId },
        instruction: { kind: "kickoff" },
      },
    ]);
    expect(h.outcomes()).toEqual([
      expect.objectContaining({
        kind: "started",
        workspaceId: "alpha",
        task: { id: taskId, title: "Ship it" },
        eventId,
        actionId,
      }),
    ]);
    expect(h.notifications).toEqual([
      expect.objectContaining({
        kind: "agent.session_started",
        repoPath: "/repos/alpha",
        repositoryLabel: "Alpha",
        role,
        task: { id: taskId, title: "Ship it" },
      }),
    ]);
  });

  test("ignores task loads, existing states, and changes that are not forward workflow steps", async () => {
    const h = await createAutopilotHarness();
    const eligible = await h.createTask("/repos/alpha", "ai_review");
    const rejected = await h.createTask("/repos/alpha", "human_review");
    const blocked = await h.createTask("/repos/alpha", "blocked");
    const building = await h.createTask("/repos/alpha", "in_progress");
    const planned = await h.createTask("/repos/alpha", "spec_ready");
    await run(h.start().initialize());
    const repoPath = "/repos/alpha";

    await run(h.tasks.listTasks({ repoPath }));
    await run(h.tasks.humanRequestChanges({ repoPath, taskId: rejected }));
    await run(h.tasks.buildResumed({ repoPath, taskId: blocked }));
    await run(h.tasks.resetImplementation({ repoPath, taskId: building }));
    await run(h.tasks.transitionTask({ repoPath, taskId: planned, status: "ai_review" }));
    await run(
      h.tasks.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        repoPath,
        taskId: eligible,
        code: "spec",
        markdown: "# Revision",
        submit: true,
      }),
    );
    await settleFibers();

    expect(h.launched).toEqual([]);
    expect(h.runEvents).toEqual([]);
  });

  test("covers every open workspace with zero browsers, and two browsers each see one outcome", async () => {
    const h = await startedHarness();
    const alphaTask = await h.createTask("/repos/alpha", "in_progress");
    const betaTask = await h.createTask("/repos/beta", "in_progress");

    await run(h.tasks.buildCompleted({ repoPath: "/repos/alpha", taskId: alphaTask }));
    await waitUntil(() => h.launched.length === 1, "the alpha launch");

    const browsers: HostEventEnvelope[][] = [[], []];
    for (const received of browsers)
      h.eventBus.subscribe("openducktor://run-event", (envelope) => received.push(envelope));
    await run(h.tasks.buildCompleted({ repoPath: "/repos/beta", taskId: betaTask }));
    await waitUntil(() => h.outcomes().length === 2, "the beta outcome");

    expect(h.launched.map(({ workspaceId, taskId }) => [workspaceId, taskId])).toEqual([
      ["alpha", alphaTask],
      ["beta", betaTask],
    ]);
    for (const received of browsers)
      expect(received).toEqual([
        {
          channel: "openducktor://run-event",
          payload: {
            type: "autopilot_outcome",
            outcome: expect.objectContaining({
              workspaceId: "beta",
              task: expect.objectContaining({ id: betaTask }),
            }),
          },
        },
      ]);
  });

  test("starts after the originating operation and its publication, once, even when publication fails", async () => {
    const h = await startedHarness();
    const taskId = await h.createTask("/repos/alpha", "ai_review");
    const entered = await run(Deferred.make<void>());
    const release = await run(Deferred.make<void>());
    // The publication snapshot fails after the commit.
    h.setPublicationGate(
      Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.andThen(
          Effect.fail(new HostOperationError({ operation: "snapshot", message: "Read failed." })),
        ),
      ),
    );
    const mutation = Effect.runFork(
      h.tasks.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        repoPath: "/repos/alpha",
        taskId,
        markdown: "Rejected",
        code: "qaReport",
        verdict: "rejected",
        submit: true,
      }),
    );
    await run(Deferred.await(entered));
    await settleFibers();
    expect(h.launched).toEqual([]);

    await run(Deferred.succeed(release, undefined));
    const exit = await run(Effect.exit(Fiber.join(mutation)));
    expect(exit._tag).toBe("Failure");
    await waitUntil(() => h.outcomes().length === 1, "the outcome");
    await settleFibers();

    expect(actionsOf(h)).toEqual(["startReviewQaFeedbacks"]);
    expect(h.service().readState({ workspaceId: "alpha" }).outcomes).toEqual([]);
  });

  test("a status alone never proves a QA rejection, and each QA cycle stays eligible", async () => {
    const h = await startedHarness();
    const repoPath = "/repos/alpha";
    const taskId = await h.createTask(repoPath, "in_progress");
    const step = async (effect: Effect.Effect<unknown, unknown>, outcomes: number) => {
      await run(effect);
      await waitUntil(() => h.outcomes().length === outcomes, `outcome ${outcomes}`);
    };

    await step(h.tasks.buildCompleted({ repoPath, taskId }), 1);
    await step(
      h.tasks.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        repoPath,
        taskId,
        markdown: "Rejected",
        code: "qaReport",
        verdict: "rejected",
        submit: true,
      }),
      2,
    );
    await step(h.tasks.buildCompleted({ repoPath, taskId }), 3);
    await step(
      h.tasks.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        repoPath,
        taskId,
        markdown: "Rejected again",
        code: "qaReport",
        verdict: "rejected",
        submit: true,
      }),
      4,
    );
    await run(h.tasks.buildBlocked({ repoPath, taskId, reason: "Needs input" }));
    await step(
      h.tasks.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        repoPath,
        taskId,
        markdown: "Rejected from blocked",
        code: "qaReport",
        verdict: "rejected",
        submit: true,
      }),
      5,
    );
    await step(h.tasks.buildCompleted({ repoPath, taskId }), 6);
    await step(
      h.tasks.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        repoPath,
        taskId,
        markdown: "Approved",
        code: "qaReport",
        verdict: "approved",
        submit: true,
      }),
      7,
    );
    // Human Review to In Progress is a QA rejection's status pair, but a human request is not one.
    await run(h.tasks.humanRequestChanges({ repoPath, taskId, note: "Change it" }));
    await settleFibers();

    expect(actionsOf(h)).toEqual([
      "startQa",
      "startReviewQaFeedbacks",
      "startQa",
      "startReviewQaFeedbacks",
      "startReviewQaFeedbacks",
      "startQa",
      "startGeneratePullRequest",
    ]);
    expect(new Set(h.outcomes().map((outcome) => outcome.outcomeId)).size).toBe(7);
  });

  test("evaluates a change with the rules saved at its commit, also if the mutation is interrupted", async () => {
    const h = await startedHarness({ rules: [] });
    const repoPath = "/repos/alpha";
    const disabledAtCommit = await h.createTask(repoPath, "in_progress");
    const interrupted = await h.createTask(repoPath, "in_progress");
    const pause = async () => {
      const committed = await run(Deferred.make<void>());
      const release = await run(Deferred.make<void>());
      h.setAfterCommitGate(
        Deferred.succeed(committed, undefined).pipe(Effect.andThen(Deferred.await(release))),
      );
      return { committed, release };
    };

    // The rule is disabled when the change commits. A save before the mutation ends does not count.
    const first = await pause();
    const firstMutation = Effect.runFork(
      h.tasks.buildCompleted({ repoPath, taskId: disabledAtCommit }),
    );
    await run(Deferred.await(first.committed));
    await h.saveConfig(configFor(ALL_RULES));
    await run(Deferred.succeed(first.release, undefined));
    await run(Fiber.join(firstMutation));
    await settleFibers();
    expect(h.launched).toEqual([]);

    // The change counts at its commit, although its caller is interrupted before the end.
    const second = await pause();
    const secondMutation = Effect.runFork(
      h.tasks.buildCompleted({ repoPath, taskId: interrupted }),
    );
    await run(Deferred.await(second.committed));
    await run(Fiber.interrupt(secondMutation));
    await waitUntil(() => h.launched.length === 1, "the launch after the interrupted mutation");

    expect(h.launched.map((request) => request.taskId)).toEqual([interrupted]);
  });

  test("a waiting attempt skips when its workspace closes or goes away during its task read", async () => {
    const h = await startedHarness();
    const alphaTask = await h.createTask("/repos/alpha", "in_progress");
    const betaTask = await h.createTask("/repos/beta", "in_progress");
    const entered = await run(Deferred.make<void>());
    const release = await run(Deferred.make<void>());
    let reads = 0;
    h.setTaskIdsGate(
      Effect.suspend(() => {
        reads += 1;
        return reads < 2
          ? Effect.void
          : Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)));
      }),
    );
    h.setLaunchGate(Effect.void);
    await run(h.tasks.buildCompleted({ repoPath: "/repos/beta", taskId: betaTask }));
    await waitUntil(() => h.outcomes().length === 1, "the first launch");
    await run(h.tasks.buildCompleted({ repoPath: "/repos/alpha", taskId: alphaTask }));
    await run(Deferred.await(entered));

    // Close and reopen alpha while its start check reads the task list.
    await h.saveConfig(configFor(ALL_RULES, { alpha: { closed: true } }));
    await h.saveConfig(configFor(ALL_RULES));
    await run(Deferred.succeed(release, undefined));
    await waitUntil(() => h.outcomes().length === 2, "the skipped attempt");

    expect(h.outcomes()[1]).toMatchObject({
      workspaceId: "alpha",
      kind: "skipped",
      reason: "The workspace closed before the action started.",
    });
    expect(h.launched.map((request) => request.workspaceId)).toEqual(["beta"]);

    // A removal during the read discards the attempt.
    const removedRelease = await run(Deferred.make<void>());
    const removedEntered = await run(Deferred.make<void>());
    h.setTaskIdsGate(
      Deferred.succeed(removedEntered, undefined).pipe(
        Effect.andThen(Deferred.await(removedRelease)),
      ),
    );
    await run(
      h.tasks.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        repoPath: "/repos/beta",
        taskId: betaTask,
        markdown: "No",
        code: "qaReport",
        verdict: "rejected",
        submit: true,
      }),
    );
    await run(Deferred.await(removedEntered));
    await h.saveConfig(configFor(ALL_RULES, { beta: { removal: true } }));
    await run(Deferred.succeed(removedRelease, undefined));
    await settleFibers();

    expect(h.outcomes()).toHaveLength(2);
    expect(h.launched).toHaveLength(1);
  });

  test("a waiting attempt skips when its task moved on, and each rapid transition keeps its meaning", async () => {
    const h = await startedHarness();
    const repoPath = "/repos/alpha";
    const taskId = await h.createTask(repoPath, "in_progress");
    const release = await run(Deferred.make<void>());
    h.setLaunchGate(Deferred.await(release));

    await run(h.tasks.buildCompleted({ repoPath, taskId }));
    await run(h.tasks.buildBlocked({ repoPath, taskId, reason: "Needs input" }));
    await run(h.tasks.buildCompleted({ repoPath, taskId }));
    await run(Deferred.succeed(release, undefined));
    await waitUntil(() => h.outcomes().length === 2, "both outcomes");

    expect(h.outcomes().map((outcome) => outcome.kind)).toEqual(["skipped", "started"]);
    expect(h.outcomes()[0]).toMatchObject({
      reason: "The task moved to AI Review before the action started.",
    });
    expect(actionsOf(h)).toEqual(["startQa"]);
  });

  test("disabled rules stay inactive, and saved settings govern later changes and waiting attempts", async () => {
    const h = await startedHarness({ rules: [] });
    const repoPath = "/repos/alpha";
    const first = await h.createTask(repoPath, "in_progress");
    const second = await h.createTask(repoPath, "in_progress");
    const third = await h.createTask(repoPath, "in_progress");

    await run(h.tasks.buildCompleted({ repoPath, taskId: first }));
    await h.saveConfig(configFor(ALL_RULES));
    // A save of the same rules sends nothing new.
    await h.saveConfig(configFor(ALL_RULES));
    await settleFibers();
    // Every client reads the saved rules again. The earlier change starts nothing.
    expect(h.runEvents).toEqual([{ type: "autopilot_settings_saved" }]);

    await run(h.tasks.buildCompleted({ repoPath, taskId: second }));
    await waitUntil(() => h.outcomes().length === 1, "the enabled rule");

    const release = await run(Deferred.make<void>());
    h.setLaunchGate(Deferred.await(release));
    await run(h.tasks.buildCompleted({ repoPath, taskId: third }));
    await settleFibers();
    await h.saveConfig(configFor([]));
    await run(Deferred.succeed(release, undefined));
    await waitUntil(() => h.outcomes().length === 2, "the skipped attempt");

    expect(h.outcomes().map((outcome) => [outcome.task.id, outcome.kind])).toEqual([
      [second, "started"],
      [third, "skipped"],
    ]);
    expect(h.outcomes()[1]).toMatchObject({
      reason: "The Autopilot rule was disabled before the action started.",
    });
    expect(h.launched.map((request) => request.taskId)).toEqual([second]);
  });

  test("closing a workspace skips its waiting attempts, reopening does not restart them, and removal discards them", async () => {
    const h = await startedHarness();
    const alphaTask = await h.createTask("/repos/alpha", "in_progress");
    const betaTask = await h.createTask("/repos/beta", "in_progress");
    const release = await run(Deferred.make<void>());
    h.setLaunchGate(Deferred.await(release));

    await run(h.tasks.buildCompleted({ repoPath: "/repos/alpha", taskId: alphaTask }));
    await run(h.tasks.buildCompleted({ repoPath: "/repos/beta", taskId: betaTask }));
    await settleFibers();
    await h.saveConfig(configFor(ALL_RULES, { alpha: { closed: true }, beta: { removal: true } }));
    await h.saveConfig(configFor(ALL_RULES, { alpha: {}, beta: { removal: true } }));
    await run(Deferred.succeed(release, undefined));
    await waitUntil(() => h.outcomes().length === 1, "the closed workspace outcome");
    await settleFibers();

    expect(h.outcomes()).toEqual([
      expect.objectContaining({
        workspaceId: "alpha",
        kind: "skipped",
        reason: "The workspace closed before the action started.",
      }),
    ]);
    expect(h.launched).toEqual([]);
    expect(h.service().readState({ workspaceId: "beta" }).outcomes).toEqual([]);

    h.setLaunchGate(Effect.void);
    await run(
      h.tasks.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        repoPath: "/repos/alpha",
        taskId: alphaTask,
        markdown: "No",
        code: "qaReport",
        verdict: "rejected",
        submit: true,
      }),
    );
    await waitUntil(() => h.outcomes().length === 2, "coverage after reopen");
    expect(actionsOf(h)).toEqual(["startReviewQaFeedbacks"]);
  });

  test("a later automatic launch can trigger the next action without waiting on itself", async () => {
    const h = await startedHarness();
    const repoPath = "/repos/alpha";
    const taskId = await h.createTask(repoPath, "spec_ready");
    // The Builder launch completes the build while it still runs, as a chained agent would.
    h.setRespond((request) =>
      request.policy.actionId === "startBuilder"
        ? h.tasks.buildResumed({ repoPath, taskId }).pipe(
            Effect.andThen(h.tasks.buildCompleted({ repoPath, taskId })),
            Effect.mapError(
              (cause) => new HostOperationError({ operation: "x", message: String(cause) }),
            ),
            Effect.as(launchResult(request, { session, startMode: "fresh" })),
          )
        : Effect.succeed(launchResult(request, { session, startMode: "reuse" })),
    );

    await run(h.tasks.workflowArtifactSave(plan(repoPath, taskId)));
    await waitUntil(() => h.outcomes().length === 2, "the chained outcome");

    expect(actionsOf(h)).toEqual(["startBuilder", "startQa"]);
    expect(h.outcomes().map((outcome) => outcome.kind)).toEqual(["started", "started"]);
    // A reused session already existed, so only the new Builder session notifies its start.
    expect(h.notifications.map((occurrence) => occurrence.role)).toEqual(["build"]);
  });

  test("launch failures notify once, stay held for clients, never retry, and allow one recovery", async () => {
    const h = await startedHarness();
    const repoPath = "/repos/alpha";
    const unsent = await h.createTask(repoPath, "in_progress", "Unsent");
    const failed = await h.createTask(repoPath, "in_progress", "Failed");
    h.setRespond((request) =>
      request.taskId === unsent
        ? Effect.succeed(
            launchResult(request, {
              status: "failed",
              session,
              unsentInstruction: [{ kind: "text", text: "Kickoff" }],
              failure: { message: "Model unavailable", cleanupErrors: [], noticeId: "notice-1" },
            }),
          )
        : Effect.fail(new HostOperationError({ operation: "launch", message: "Runtime is down." })),
    );

    await run(h.tasks.buildCompleted({ repoPath, taskId: unsent }));
    await run(h.tasks.buildCompleted({ repoPath, taskId: failed }));
    await waitUntil(() => h.outcomes().length === 2, "both failures");
    await settleFibers();

    expect(h.launched).toHaveLength(2);
    const held = h.service().readState({ workspaceId: "alpha" });
    expect(held.outcomes).toEqual([
      expect.objectContaining({ kind: "failed", message: "Model unavailable" }),
      expect.objectContaining({ kind: "failed", message: "Runtime is down." }),
    ]);
    // Clients skip the in-app toast of the notification that Autopilot published.
    expect(held.outcomes[0]).not.toHaveProperty("notificationId");
    expect(held.outcomes[1]).toMatchObject({
      notificationId: h.notifications[0]?.occurrenceId,
    });
    // The host already notified the session notice, so Autopilot notifies only the other failure.
    expect(h.notifications).toEqual([
      expect.objectContaining({
        kind: "agent.session_error",
        status: "Runtime is down.",
        navigationTarget: {
          type: "agent_studio_task",
          repoPath,
          taskId: failed,
          preferredRole: "qa",
        },
      }),
    ]);
    const [recoverable, unrecoverable] = held.outcomes;
    const claim = (outcomeId = "") =>
      h.service().claimRecovery({ workspaceId: "alpha", outcomeId });
    expect(claim(recoverable?.outcomeId)).toEqual({ claimed: true });
    expect(claim(recoverable?.outcomeId)).toEqual({ claimed: false });
    expect(claim(unrecoverable?.outcomeId)).toEqual({ claimed: false });
  });

  test("a notification failure does not change or restart the attempt", async () => {
    const h = await startedHarness();
    const taskId = await h.createTask("/repos/alpha", "in_progress");
    h.setNotificationFailure(new HostOperationError({ operation: "notify", message: "Closed" }));

    await run(h.tasks.buildCompleted({ repoPath: "/repos/alpha", taskId }));
    await waitUntil(() => h.backgroundFailures.length === 1, "the background failure");
    await settleFibers();

    expect(h.launched).toHaveLength(1);
    expect(h.outcomes().map((outcome) => outcome.kind)).toEqual(["started"]);
  });

  test("a launch policy skip and a deleted task show as skipped outcomes", async () => {
    const h = await startedHarness();
    const repoPath = "/repos/alpha";
    const skipped = await h.createTask(repoPath, "in_progress");
    const deleted = await h.createTask(repoPath, "in_progress");
    h.setRespond((request) =>
      Effect.succeed(launchResult(request, { status: "skipped", skipReason: "No worktree." })),
    );
    await run(h.tasks.buildCompleted({ repoPath, taskId: skipped }));
    await waitUntil(() => h.outcomes().length === 1, "the policy skip");

    const release = await run(Deferred.make<void>());
    h.setLaunchGate(Deferred.await(release));
    await run(h.tasks.buildCompleted({ repoPath, taskId: deleted }));
    await run(h.tasks.deleteTask({ repoPath, taskId: deleted }));
    await run(Deferred.succeed(release, undefined));
    await waitUntil(() => h.outcomes().length === 2, "the deleted task skip");

    expect(
      h
        .service()
        .readState({ workspaceId: "alpha" })
        .outcomes.map((outcome) => (outcome.kind === "skipped" ? outcome.reason : outcome.kind)),
    ).toEqual(["No worktree.", "The task was deleted before the action started."]);
  });

  test.each<{
    name: string;
    respond: (request: AutomaticLaunchInput) => Effect.Effect<WorkflowLaunchResult, HostError>;
    expected: Partial<AutopilotOutcome>;
  }>([
    {
      name: "a launch error",
      respond: () => Effect.fail(new HostOperationError({ operation: "launch", message: "" })),
      expected: { kind: "failed", message: "The launch failed." },
    },
    {
      name: "a launch failure",
      respond: (request) =>
        Effect.succeed(
          launchResult(request, { status: "failed", failure: { message: "", cleanupErrors: [] } }),
        ),
      expected: { kind: "failed", message: "The launch failed." },
    },
    {
      name: "a launch skip",
      respond: (request) =>
        Effect.succeed(launchResult(request, { status: "skipped", skipReason: "" })),
      expected: { kind: "skipped", reason: "The launch was skipped." },
    },
  ])("$name without text gives an outcome that clients can read", async ({ respond, expected }) => {
    const h = await startedHarness();
    const taskId = await h.createTask("/repos/alpha", "in_progress");
    h.setRespond(respond);

    await run(h.tasks.buildCompleted({ repoPath: "/repos/alpha", taskId }));
    await waitUntil(() => h.outcomes().length === 1, "the outcome");

    const state = autopilotStateSchema.parse(h.service().readState({ workspaceId: "alpha" }));
    expect(state.outcomes).toEqual([expect.objectContaining(expected)]);
  });

  test("a host restart starts no work for existing states and keeps no outcomes", async () => {
    const first = await startedHarness();
    const repoPath = "/repos/alpha";
    const taskId = await first.createTask(repoPath, "in_progress");
    first.setRespond(() =>
      Effect.fail(new HostOperationError({ operation: "launch", message: "x" })),
    );
    await run(first.tasks.buildCompleted({ repoPath, taskId }));
    await waitUntil(() => first.outcomes().length === 1, "the failure");
    await run(first.service().dispose());

    const restarted = await startedHarness({ stores: first.stores });
    await settleFibers();
    expect(restarted.launched).toEqual([]);
    expect(restarted.service().readState({ workspaceId: "alpha" })).toEqual({
      outcomes: [],
      failure: null,
    });

    await run(
      restarted.tasks.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        repoPath,
        taskId,
        markdown: "Rejected",
        code: "qaReport",
        verdict: "rejected",
        submit: true,
      }),
    );
    await waitUntil(() => restarted.launched.length === 1, "coverage after restart");
    expect(actionsOf(restarted)).toEqual(["startReviewQaFeedbacks"]);
  });

  test("dispose discards waiting attempts", async () => {
    const h = await startedHarness();
    const taskId = await h.createTask("/repos/alpha", "in_progress");
    const release = await run(Deferred.make<void>());
    h.setLaunchGate(Deferred.await(release));
    await run(h.tasks.buildCompleted({ repoPath: "/repos/alpha", taskId }));
    await settleFibers();

    await run(h.service().dispose());
    await run(Deferred.succeed(release, undefined));
    await run(
      h.tasks.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        repoPath: "/repos/alpha",
        taskId,
        markdown: "Rejected",
        code: "qaReport",
        verdict: "rejected",
        submit: true,
      }),
    );
    await settleFibers();

    expect(h.launched).toEqual([]);
    expect(h.runEvents).toEqual([]);
  });

  test("an attempt defect reports a background failure and holds no outcome", async () => {
    const h = await startedHarness();
    const taskId = await h.createTask("/repos/alpha", "in_progress");
    h.setRespond(() => Effect.die(new Error("Launch crashed.")));

    await run(h.tasks.buildCompleted({ repoPath: "/repos/alpha", taskId }));
    await waitUntil(() => h.backgroundFailures.length === 1, "the attempt failure");
    await settleFibers();

    expect(h.backgroundFailures).toEqual([
      expect.objectContaining({ operation: "autopilot.attempt", message: "Launch crashed." }),
    ]);
    expect(h.outcomes()).toEqual([]);
  });

  test("reports why it cannot evaluate changes, with the recovery step", async () => {
    const h = await createAutopilotHarness();
    h.setReadFailure(new HostOperationError({ operation: "read", message: "Config is invalid." }));
    await run(h.start().initialize());
    expect(h.service().readState({ workspaceId: "alpha" }).failure).toBe(
      "Autopilot could not read the application settings: Config is invalid. Correct the application settings, then restart the host.",
    );

    const ready = await startedHarness({ stores: h.stores });
    ready.service().observe({
      repoPath: "/repos/unknown",
      operation: "save-workflow-artifact",
      signal: "taskRejectedByQa",
      statusChange: {
        previousStatus: "ai_review",
        task: { id: "task", title: "Task", status: "in_progress" },
      },
    });
    expect(ready.runEvents).toEqual([
      {
        type: "autopilot_failure",
        failure:
          "Autopilot cannot match task changes in /repos/unknown to a workspace. Restart the host.",
      },
    ]);
  });
});
