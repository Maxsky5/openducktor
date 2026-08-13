import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { Effect, type Scope } from "effect";
import { listTasksInDatabase } from "../src/adapters/sqlite/sqlite-task-card-read-model";
import { createSqliteTaskRepository } from "../src/adapters/sqlite/sqlite-task-repository";
import {
  type TaskStoreSession,
  taskDocuments,
  taskStoreSchema,
  tasks,
} from "../src/adapters/sqlite/sqlite-task-store-schema";
import { currentSqliteDriverRuntime } from "../src/infrastructure/sqlite/sqlite-driver";
import {
  openSqliteDrizzleConnection,
  type SqliteDrizzleConnection,
} from "../src/infrastructure/sqlite/sqlite-drizzle-client";
import {
  evaluateLatencySamples,
  evaluateThroughputRates,
  type LatencyGateResult,
  type LatencySummary,
  type ThroughputResult,
} from "./sqlite-task-store-lifecycle-gate";

const PROFILE_DEFINITIONS = [
  { name: "empty", taskCount: 0, samples: 160 },
  { name: "small", taskCount: 25, samples: 120 },
  { name: "representative", taskCount: 250, samples: 60 },
] as const;

const WARMUP_SAMPLES = 20;
const MIXED_OPERATION_COUNT = 120;
const CONCURRENT_READ_COUNT = 120;
const CONCURRENT_READ_LIMIT = 4;

type HandleTracker = {
  active: number;
  maximum: number;
  opened: number;
};

type LifecycleResult = LatencySummary & {
  maximumLiveHandles: number;
  openedHandles: number;
};

type ProfileResult = {
  current: LifecycleResult;
  gate: LatencyGateResult;
  profile: (typeof PROFILE_DEFINITIONS)[number]["name"];
  retained: LifecycleResult;
  taskCount: number;
};

const measure = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<number, E> =>
  Effect.gen(function* () {
    const startedAt = performance.now();
    yield* effect;
    return performance.now() - startedAt;
  });

const trackConnection = <TSchema extends Record<string, unknown>, E>(
  tracker: HandleTracker,
  acquire: Effect.Effect<SqliteDrizzleConnection<TSchema>, E, Scope.Scope>,
): Effect.Effect<SqliteDrizzleConnection<TSchema>, E, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      tracker.active += 1;
      tracker.opened += 1;
      tracker.maximum = Math.max(tracker.maximum, tracker.active);
    }).pipe(Effect.zipRight(acquire)),
    () =>
      Effect.sync(() => {
        tracker.active -= 1;
      }),
  );

const openConnection = (databasePath: string, tracker?: HandleTracker) => {
  const acquire = openSqliteDrizzleConnection<typeof taskStoreSchema>({
    config: { schema: taskStoreSchema },
    databasePath,
  });
  return tracker ? trackConnection(tracker, acquire) : acquire;
};

const readTasks = (session: TaskStoreSession): Effect.Effect<void, unknown> =>
  listTasksInDatabase(session, { repoPath: "/benchmark" }, () => new Date()).pipe(Effect.asVoid);

const updateTask = (session: TaskStoreSession, taskId: string): Effect.Effect<void, unknown> =>
  session
    .transaction("benchmark.updateTask", (transaction) =>
      transaction.execute(
        (database) =>
          database.update(tasks).set({ updatedAt: new Date() }).where(sql`${tasks.id} = ${taskId}`),
        "benchmark.updateTask.execute",
      ),
    )
    .pipe(Effect.asVoid);

const initializeDatabase = (databasePath: string): Effect.Effect<void, unknown> => {
  const repository = createSqliteTaskRepository({
    resolveDatabasePath: () => Effect.succeed(databasePath),
    resolveWorkspaceIdForRepoPath: () => Effect.succeed("benchmark"),
  });
  return repository.diagnoseRepoStore({ repoPath: "/benchmark" }).pipe(Effect.asVoid);
};

const populateDatabase = (
  databasePath: string,
  taskCount: number,
): Effect.Effect<void, unknown> => {
  if (taskCount === 0) {
    return Effect.void;
  }
  const now = Date.now();
  const taskRows = Array.from({ length: taskCount }, (_, index) => ({
    id: `benchmark-${index}`,
    title: `Benchmark task ${index}`,
    description: index % 3 === 0 ? "Representative task description" : null,
    status: index % 5 === 0 ? ("closed" as const) : ("open" as const),
    issueType: index % 7 === 0 ? ("feature" as const) : ("task" as const),
    priority: index % 5,
    parentId: index > 0 && index % 10 === 0 ? `benchmark-${index - 1}` : null,
    qaRequired: index % 2,
    labelsJson: index % 4 === 0 ? '["benchmark"]' : "[]",
    agentSessionsJson: "[]",
    targetBranchJson: null,
    pullRequestJson: null,
    directMergeJson: null,
    createdAt: new Date(now - index * 1_000),
    updatedAt: new Date(now - index * 500),
  }));
  const documentRows = taskRows.flatMap((task, index) =>
    index % 3 === 0
      ? [
          {
            taskId: task.id,
            kind: "spec" as const,
            revision: 1,
            markdown: "# Benchmark specification",
            format: "plain_text" as const,
            verdict: null,
            sourceTool: "benchmark",
            updatedBy: null,
            updatedAt: task.updatedAt,
          },
        ]
      : [],
  );

  return Effect.scoped(
    Effect.gen(function* () {
      const { session } = yield* openConnection(databasePath);
      yield* session.execute(
        (database) => database.insert(tasks).values(taskRows),
        "benchmark.populateTasks",
      );
      if (documentRows.length > 0) {
        yield* session.execute(
          (database) => database.insert(taskDocuments).values(documentRows),
          "benchmark.populateDocuments",
        );
      }
    }),
  );
};

const makeCurrentOperation = (
  databasePath: string,
  tracker: HandleTracker,
  use: (session: TaskStoreSession) => Effect.Effect<void, unknown>,
): Effect.Effect<void, unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.tryPromise(() => mkdir(path.dirname(databasePath), { recursive: true }));
      const { session } = yield* openConnection(databasePath, tracker);
      yield* use(session);
    }),
  );

const benchmarkProfile = (
  databasePath: string,
  definition: (typeof PROFILE_DEFINITIONS)[number],
): Effect.Effect<ProfileResult, unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const currentTracker: HandleTracker = { active: 0, maximum: 0, opened: 0 };
      const retainedTracker: HandleTracker = { active: 0, maximum: 0, opened: 0 };
      const retainedConnection = yield* openConnection(databasePath, retainedTracker);
      const permit = yield* Effect.makeSemaphore(1);
      const retainedRead = permit.withPermits(1)(readTasks(retainedConnection.session));
      const currentRead = makeCurrentOperation(databasePath, currentTracker, readTasks);

      for (let index = 0; index < WARMUP_SAMPLES; index += 1) {
        yield* index % 2 === 0 ? currentRead : retainedRead;
        yield* index % 2 === 0 ? retainedRead : currentRead;
      }

      const currentSamples: number[] = [];
      const retainedSamples: number[] = [];
      for (let index = 0; index < definition.samples; index += 1) {
        if (index % 2 === 0) {
          currentSamples.push(yield* measure(currentRead));
          retainedSamples.push(yield* measure(retainedRead));
        } else {
          retainedSamples.push(yield* measure(retainedRead));
          currentSamples.push(yield* measure(currentRead));
        }
      }

      const evaluation = evaluateLatencySamples(currentSamples, retainedSamples);

      return {
        current: {
          ...evaluation.current,
          maximumLiveHandles: currentTracker.maximum,
          openedHandles: currentTracker.opened,
        },
        gate: evaluation.gate,
        profile: definition.name,
        retained: {
          ...evaluation.retained,
          maximumLiveHandles: retainedTracker.maximum,
          openedHandles: retainedTracker.opened,
        },
        taskCount: definition.taskCount,
      };
    }),
  );

const runOperations = (
  operations: readonly Effect.Effect<void, unknown>[],
  concurrency: number,
): Effect.Effect<number, unknown> =>
  Effect.gen(function* () {
    const startedAt = performance.now();
    yield* Effect.all(operations, { concurrency, discard: true });
    return operations.length / ((performance.now() - startedAt) / 1_000);
  });

const benchmarkThroughput = (
  databasePath: string,
): Effect.Effect<{ pass: boolean; result: ThroughputResult }, unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const currentTracker: HandleTracker = { active: 0, maximum: 0, opened: 0 };
      const retainedTracker: HandleTracker = { active: 0, maximum: 0, opened: 0 };
      const retainedConnection = yield* openConnection(databasePath, retainedTracker);
      const permit = yield* Effect.makeSemaphore(1);
      const retainedRead = permit.withPermits(1)(readTasks(retainedConnection.session));
      const currentRead = makeCurrentOperation(databasePath, currentTracker, readTasks);
      const retainedWrite = permit.withPermits(1)(
        updateTask(retainedConnection.session, "benchmark-0"),
      );
      const currentWrite = makeCurrentOperation(databasePath, currentTracker, (session) =>
        updateTask(session, "benchmark-0"),
      );

      const currentMixed = Array.from({ length: MIXED_OPERATION_COUNT }, (_, index) =>
        index % 5 === 0 ? currentWrite : currentRead,
      );
      const retainedMixed = Array.from({ length: MIXED_OPERATION_COUNT }, (_, index) =>
        index % 5 === 0 ? retainedWrite : retainedRead,
      );
      const currentConcurrent = Array.from({ length: CONCURRENT_READ_COUNT }, () => currentRead);
      const retainedConcurrent = Array.from({ length: CONCURRENT_READ_COUNT }, () => retainedRead);

      yield* currentRead;
      yield* retainedRead;

      const currentMixedRate = yield* runOperations(currentMixed, 1);
      const retainedMixedRate = yield* runOperations(retainedMixed, 1);
      const currentConcurrentRate = yield* runOperations(currentConcurrent, CONCURRENT_READ_LIMIT);
      const retainedConcurrentRate = yield* runOperations(
        retainedConcurrent,
        CONCURRENT_READ_LIMIT,
      );

      if (retainedTracker.maximum !== 1) {
        return yield* Effect.fail(
          new Error(
            `Retained benchmark opened ${retainedTracker.maximum} live handles for one database path.`,
          ),
        );
      }

      return evaluateThroughputRates({
        currentConcurrentRate,
        currentMixedRate,
        retainedConcurrentRate,
        retainedMixedRate,
      });
    }),
  );

const runBenchmark = Effect.gen(function* () {
  const root = yield* Effect.acquireRelease(
    Effect.tryPromise(() => mkdtemp(path.join(tmpdir(), "openducktor-sqlite-lifecycle-"))),
    (directory) =>
      Effect.tryPromise(() => rm(directory, { force: true, recursive: true })).pipe(Effect.orDie),
  );
  const profileResults: ProfileResult[] = [];
  let representativeDatabasePath = "";

  for (const definition of PROFILE_DEFINITIONS) {
    const databasePath = path.join(root, definition.name, "database.sqlite");
    yield* initializeDatabase(databasePath);
    yield* populateDatabase(databasePath, definition.taskCount);
    profileResults.push(yield* benchmarkProfile(databasePath, definition));
    if (definition.name === "representative") {
      representativeDatabasePath = databasePath;
    }
  }

  const throughputEvaluation = yield* benchmarkThroughput(representativeDatabasePath);
  const throughput = throughputEvaluation.result;
  const latencyPass = profileResults.every(
    (profile) => profile.gate.p50Pass && profile.gate.p95Pass,
  );
  const throughputPass = throughputEvaluation.pass;
  const handlePass = profileResults.every((profile) => profile.retained.maximumLiveHandles === 1);

  return {
    gate: {
      handlePass,
      latencyPass,
      pass: handlePass && latencyPass && throughputPass,
      throughputPass,
    },
    profiles: profileResults,
    runtime: currentSqliteDriverRuntime(),
    runtimeVersion: "Bun" in globalThis ? Bun.version : process.versions.node,
    throughput,
  };
});

const result = await Effect.runPromise(Effect.scoped(runBenchmark));
console.log(JSON.stringify(result));
