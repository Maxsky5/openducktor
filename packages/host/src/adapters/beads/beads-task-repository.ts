import { Cause, Clock, Effect } from "effect";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";
import {
  defaultRunBd,
  defaultRunBdJson,
} from "../../infrastructure/beads/task-store/beads-command-runner";
import { diagnoseRepoStoreWithBd } from "../../infrastructure/beads/task-store/beads-documents";
import {
  clearAgentSessionsByRolesWithBd,
  clearQaReportsWithBd,
  clearWorkflowDocumentsWithBd,
  recordQaOutcomeWithBd,
  setDirectMergeWithBd,
  setPullRequestWithBd,
  upsertAgentSessionWithBd,
  writeDocumentWithBd,
} from "../../infrastructure/beads/task-store/beads-metadata-writer";
import type {
  BeadsTaskRepository,
  CreateBeadsTaskRepositoryInput,
  ResolveBeadsCliContext,
} from "../../infrastructure/beads/task-store/beads-raw-issue";
import {
  createTaskWithBd,
  deleteTaskWithBd,
  getTaskMetadataWithBd,
  getTaskWithBd,
  listPullRequestSyncCandidatesWithBd,
  listTasksWithBd,
  transitionTaskWithBd,
  updateTaskWithBd,
} from "../../infrastructure/beads/task-store/beads-task-commands";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import {
  type BeadsCliContext,
  resolveBeadsCliContext,
  stopOwnedSharedDoltServer,
} from "./beads-cli-context";
import {
  awaitBeadsCliContextFlight,
  type BeadsCliContextFlight,
  makeBeadsCliContextFlight,
  resolveBeadsCliContextFlight,
} from "./beads-cli-context-flight";
import { createBeadsCliContextRequestResolver } from "./beads-cli-context-request";
import { cloneTasks, createTaskListCache } from "./beads-task-list-cache";
import { mapTaskStoreErrors } from "./beads-task-store-errors";
import { createBeadsToolPathResolver, createSharedDoltToolPathResolver } from "./beads-tool-paths";

export type { BeadsTaskRepository } from "../../infrastructure/beads/task-store/beads-raw-issue";

export const createBeadsTaskRepository = ({
  now = () => new Date(),
  processEnv = process.env,
  runBd,
  runBdJson,
  resolveCliContext = resolveBeadsCliContext,
  resolveWorkspaceIdForRepoPath,
  stopSharedDoltServer = stopOwnedSharedDoltServer,
  toolDiscovery,
}: CreateBeadsTaskRepositoryInput = {}): BeadsTaskRepository => {
  const ownedSharedDoltServers = new Map<string, BeadsCliContext["sharedServer"]>();
  const cliContextFlights = new Set<BeadsCliContextFlight>();
  const readyCliContexts = new Map<string, BeadsCliContextFlight>();
  const taskListCache = createTaskListCache();
  let closing = false;
  const resolveBeadsToolPaths = createBeadsToolPathResolver(toolDiscovery);
  const resolveSharedDoltToolPaths = createSharedDoltToolPathResolver(toolDiscovery);
  const resolveContextRequest = createBeadsCliContextRequestResolver({
    isClosing: () => closing,
    processEnv,
    resolveBeadsToolPaths,
    resolveSharedDoltToolPaths,
    ...(resolveWorkspaceIdForRepoPath === undefined ? {} : { resolveWorkspaceIdForRepoPath }),
  });
  const trackOwnedSharedServer = (context: BeadsCliContext): BeadsCliContext => {
    if (context.sharedServer?.ownerPid === process.pid) {
      ownedSharedDoltServers.set(context.serverStatePath, context.sharedServer);
    }
    return context;
  };
  const trackCliContextResolution = (
    contextEffect: Effect.Effect<BeadsCliContext, TaskStoreError>,
  ): Effect.Effect<BeadsCliContext, TaskStoreError> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const flight = yield* Effect.sync(() => {
          const nextFlight = makeBeadsCliContextFlight();
          cliContextFlights.add(nextFlight);
          return nextFlight;
        });
        yield* Effect.forkDaemon(
          resolveBeadsCliContextFlight({
            flight,
            releaseReservation: Effect.sync(() => cliContextFlights.delete(flight)),
            rememberOwnedContext: trackOwnedSharedServer,
            resolveContext: contextEffect,
          }),
        );
        return yield* restore(awaitBeadsCliContextFlight(flight));
      }),
    );
  const resolveEffectiveCliContext: ResolveBeadsCliContext = (repoPath, options = {}) =>
    Effect.gen(function* () {
      const request = yield* resolveContextRequest(repoPath, options);
      if (options.requireSharedServer !== true) {
        return yield* trackCliContextResolution(resolveCliContext(repoPath, request.options));
      }
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const reservation = yield* Effect.sync(() => {
            const cached = readyCliContexts.get(request.cacheKey);
            if (cached) {
              return { _tag: "existing" as const, flight: cached };
            }
            const flight = makeBeadsCliContextFlight();
            cliContextFlights.add(flight);
            readyCliContexts.set(request.cacheKey, flight);
            return { _tag: "created" as const, flight };
          });
          if (reservation._tag === "existing") {
            return yield* restore(awaitBeadsCliContextFlight(reservation.flight));
          }
          yield* Effect.forkDaemon(
            resolveBeadsCliContextFlight({
              evictCachedContext: Effect.sync(() => {
                if (readyCliContexts.get(request.cacheKey) === reservation.flight) {
                  readyCliContexts.delete(request.cacheKey);
                }
              }),
              flight: reservation.flight,
              releaseReservation: Effect.sync(() => cliContextFlights.delete(reservation.flight)),
              rememberOwnedContext: trackOwnedSharedServer,
              resolveContext: resolveCliContext(repoPath, request.options),
            }),
          );
          return yield* restore(awaitBeadsCliContextFlight(reservation.flight));
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        toHostOperationError(cause, "beadsTaskRepository.resolveEffectiveCliContext", {
          repoPath,
          requireSharedServer: options.requireSharedServer === true,
        }),
      ),
    );
  const effectiveRunBd = runBd ?? defaultRunBd(resolveEffectiveCliContext);
  const effectiveRunBdJson = runBdJson ?? defaultRunBdJson(resolveEffectiveCliContext);
  const requireBdCommand = () => resolveBeadsToolPaths();
  const requireSharedDoltCommand = () => resolveSharedDoltToolPaths();
  const runBdJsonForRepo = (repoPath: string) =>
    Effect.gen(function* () {
      if (runBdJson) {
        return effectiveRunBdJson;
      }
      yield* requireBdCommand();
      yield* requireSharedDoltCommand();
      const context = yield* resolveEffectiveCliContext(repoPath, { requireSharedServer: true });
      return (commandRepoPath: string, args: string[]) =>
        effectiveRunBdJson(commandRepoPath, args, context);
    });
  const runBdForRepo = (repoPath: string) =>
    Effect.gen(function* () {
      if (runBd) {
        return effectiveRunBd;
      }
      yield* requireBdCommand();
      yield* requireSharedDoltCommand();
      const context = yield* resolveEffectiveCliContext(repoPath, { requireSharedServer: true });
      return (commandRepoPath: string, args: string[]) =>
        effectiveRunBd(commandRepoPath, args, context);
    });
  const repository: BeadsTaskRepository = {
    close() {
      return Effect.gen(function* () {
        closing = true;
        yield* Effect.forEach(
          [...cliContextFlights],
          (flight) => Effect.either(awaitBeadsCliContextFlight(flight)),
          { concurrency: "unbounded" },
        );
        const errors: string[] = [];
        let stoppedSharedDoltServers = 0;
        for (const [serverStatePath, sharedServer] of ownedSharedDoltServers) {
          if (!sharedServer) {
            continue;
          }
          const stopResult = yield* Effect.exit(
            stopSharedDoltServer(sharedServer, serverStatePath),
          );
          if (stopResult._tag === "Success") {
            stoppedSharedDoltServers += 1;
            ownedSharedDoltServers.delete(serverStatePath);
          } else {
            const message = Cause.pretty(stopResult.cause);
            errors.push(`Failed stopping shared Dolt server ${sharedServer.pid}: ${message}`);
          }
        }
        if (errors.length > 0) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "beadsTaskRepository.close",
              message: errors.join("\n"),
              details: { failures: errors },
            }),
          );
        }
        return { stoppedSharedDoltServers };
      });
    },
    listTasks({ repoPath, doneVisibleDays }) {
      return Effect.gen(function* () {
        const cacheCheckedAt = yield* Clock.currentTimeMillis;
        const cached = taskListCache.cachedTaskListAndGeneration(
          repoPath,
          doneVisibleDays,
          cacheCheckedAt,
        );
        if (cached.tasks) {
          return cached.tasks;
        }
        const runBdJsonForOperation = yield* runBdJsonForRepo(repoPath);
        const tasks = yield* listTasksWithBd(runBdJsonForOperation, now, repoPath, doneVisibleDays);
        taskListCache.cacheTaskListIfGeneration(
          repoPath,
          doneVisibleDays,
          cached.generation,
          tasks,
          yield* Clock.currentTimeMillis,
        );
        return cloneTasks(tasks);
      });
    },
    getTask({ repoPath, taskId }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* runBdJsonForRepo(repoPath);
        return yield* getTaskWithBd(runBdJsonForOperation, repoPath, taskId);
      });
    },
    getTaskMetadata({ repoPath, taskId }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* runBdJsonForRepo(repoPath);
        return yield* getTaskMetadataWithBd(runBdJsonForOperation, repoPath, taskId);
      });
    },
    diagnoseRepoStore({ repoPath, prepare = false }) {
      return Effect.gen(function* () {
        yield* requireBdCommand();
        if (prepare) {
          yield* requireSharedDoltCommand();
        }
        return yield* diagnoseRepoStoreWithBd(
          effectiveRunBdJson,
          repoPath,
          resolveEffectiveCliContext,
          prepare,
        );
      });
    },
    listPullRequestSyncCandidates({ repoPath }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* runBdJsonForRepo(repoPath);
        return yield* listPullRequestSyncCandidatesWithBd(runBdJsonForOperation, now, repoPath);
      });
    },
    setSpecDocument({ repoPath, taskId, markdown }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* runBdJsonForRepo(repoPath);
        const document = yield* writeDocumentWithBd(
          runBdJsonForOperation,
          now,
          repoPath,
          taskId,
          markdown,
          "spec",
        );
        taskListCache.invalidateTaskListCache(repoPath);
        return document;
      });
    },
    setPlanDocument({ repoPath, taskId, markdown }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* runBdJsonForRepo(repoPath);
        const document = yield* writeDocumentWithBd(
          runBdJsonForOperation,
          now,
          repoPath,
          taskId,
          markdown,
          "implementationPlan",
        );
        taskListCache.invalidateTaskListCache(repoPath);
        return document;
      });
    },
    recordQaOutcome({ repoPath, taskId, status, markdown, verdict }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* runBdJsonForRepo(repoPath);
        const task = yield* recordQaOutcomeWithBd(
          runBdJsonForOperation,
          now,
          repoPath,
          taskId,
          status,
          markdown,
          verdict,
        );
        taskListCache.invalidateTaskListCache(repoPath);
        return task;
      });
    },
    upsertAgentSession({ repoPath, taskId, session }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* runBdJsonForRepo(repoPath);
        const updated = yield* upsertAgentSessionWithBd(
          runBdJsonForOperation,
          repoPath,
          taskId,
          session,
        );
        taskListCache.invalidateTaskListCache(repoPath);
        return updated;
      });
    },
    setPullRequest({ repoPath, taskId, pullRequest }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* runBdJsonForRepo(repoPath);
        const updated = yield* setPullRequestWithBd(
          runBdJsonForOperation,
          repoPath,
          taskId,
          pullRequest,
        );
        taskListCache.invalidateTaskListCache(repoPath);
        return updated;
      });
    },
    setDirectMerge({ repoPath, taskId, directMerge }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* runBdJsonForRepo(repoPath);
        const updated = yield* setDirectMergeWithBd(
          runBdJsonForOperation,
          repoPath,
          taskId,
          directMerge,
        );
        taskListCache.invalidateTaskListCache(repoPath);
        return updated;
      });
    },
    clearAgentSessionsByRoles({ repoPath, taskId, roles }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* runBdJsonForRepo(repoPath);
        const updated = yield* clearAgentSessionsByRolesWithBd(
          runBdJsonForOperation,
          repoPath,
          taskId,
          roles,
        );
        taskListCache.invalidateTaskListCache(repoPath);
        return updated;
      });
    },
    clearWorkflowDocuments({ repoPath, taskId }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* runBdJsonForRepo(repoPath);
        const updated = yield* clearWorkflowDocumentsWithBd(
          runBdJsonForOperation,
          repoPath,
          taskId,
        );
        taskListCache.invalidateTaskListCache(repoPath);
        return updated;
      });
    },
    clearQaReports({ repoPath, taskId }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* runBdJsonForRepo(repoPath);
        const updated = yield* clearQaReportsWithBd(runBdJsonForOperation, repoPath, taskId);
        taskListCache.invalidateTaskListCache(repoPath);
        return updated;
      });
    },
    createTask({ repoPath, task }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* runBdJsonForRepo(repoPath);
        const created = yield* createTaskWithBd(runBdJsonForOperation, repoPath, task);
        taskListCache.invalidateTaskListCache(repoPath);
        return created;
      });
    },
    updateTask({ repoPath, taskId, patch }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* runBdJsonForRepo(repoPath);
        const updated = yield* updateTaskWithBd(runBdJsonForOperation, repoPath, taskId, patch);
        taskListCache.invalidateTaskListCache(repoPath);
        return updated;
      });
    },
    transitionTask({ repoPath, taskId, status }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* runBdJsonForRepo(repoPath);
        const updated = yield* transitionTaskWithBd(
          runBdJsonForOperation,
          repoPath,
          taskId,
          status,
        );
        taskListCache.invalidateTaskListCache(repoPath);
        return updated;
      });
    },
    deleteTask({ repoPath, taskId, deleteSubtasks }) {
      return Effect.gen(function* () {
        const runBdForOperation = yield* runBdForRepo(repoPath);
        const deleted = yield* deleteTaskWithBd(
          runBdForOperation,
          repoPath,
          taskId,
          deleteSubtasks,
        );
        taskListCache.invalidateTaskListCache(repoPath);
        return deleted;
      });
    },
  };
  return {
    clearAgentSessionsByRoles: (input) =>
      mapTaskStoreErrors(repository.clearAgentSessionsByRoles(input)),
    clearQaReports: (input) => mapTaskStoreErrors(repository.clearQaReports(input)),
    clearWorkflowDocuments: (input) => mapTaskStoreErrors(repository.clearWorkflowDocuments(input)),
    close: () => mapTaskStoreErrors(repository.close()),
    createTask: (input) => mapTaskStoreErrors(repository.createTask(input)),
    deleteTask: (input) => mapTaskStoreErrors(repository.deleteTask(input)),
    diagnoseRepoStore: (input) => mapTaskStoreErrors(repository.diagnoseRepoStore(input)),
    getTask: (input) => mapTaskStoreErrors(repository.getTask(input)),
    getTaskMetadata: (input) => mapTaskStoreErrors(repository.getTaskMetadata(input)),
    listPullRequestSyncCandidates: (input) =>
      mapTaskStoreErrors(repository.listPullRequestSyncCandidates(input)),
    listTasks: (input) => mapTaskStoreErrors(repository.listTasks(input)),
    recordQaOutcome: (input) => mapTaskStoreErrors(repository.recordQaOutcome(input)),
    setDirectMerge: (input) => mapTaskStoreErrors(repository.setDirectMerge(input)),
    setPlanDocument: (input) => mapTaskStoreErrors(repository.setPlanDocument(input)),
    setPullRequest: (input) => mapTaskStoreErrors(repository.setPullRequest(input)),
    setSpecDocument: (input) => mapTaskStoreErrors(repository.setSpecDocument(input)),
    transitionTask: (input) => mapTaskStoreErrors(repository.transitionTask(input)),
    updateTask: (input) => mapTaskStoreErrors(repository.updateTask(input)),
    upsertAgentSession: (input) => mapTaskStoreErrors(repository.upsertAgentSession(input)),
  };
};
