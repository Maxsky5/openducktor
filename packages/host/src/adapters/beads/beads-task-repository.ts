import { Cause, Effect, Fiber } from "effect";
import {
  HostDependencyError,
  HostOperationError,
  HostResourceError,
  toHostOperationError,
} from "../../effect/host-errors";
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
import { cloneTasks, createTaskListCache } from "./beads-task-list-cache";
import { mapTaskStoreErrors } from "./beads-task-store-errors";

export type { BeadsTaskRepository } from "../../infrastructure/beads/task-store/beads-raw-issue";

type CliContextRequest = {
  cacheKey: string;
  options: Parameters<ResolveBeadsCliContext>[1];
};

export const createBeadsTaskRepository = ({
  now = () => new Date(),
  processEnv = process.env,
  runBd,
  runBdJson,
  resolveCliContext = resolveBeadsCliContext,
  resolveWorkspaceIdForRepoPath,
  stopSharedDoltServer = stopOwnedSharedDoltServer,
  systemCommands,
}: CreateBeadsTaskRepositoryInput = {}): BeadsTaskRepository => {
  const ownedSharedDoltServers = new Map<string, BeadsCliContext["sharedServer"]>();
  const cliContextFlights = new Set<Fiber.RuntimeFiber<BeadsCliContext, TaskStoreError>>();
  const readyCliContexts = new Map<string, Fiber.RuntimeFiber<BeadsCliContext, TaskStoreError>>();
  const taskListCache = createTaskListCache();
  let closing = false;
  const assertRequiredCommand = (command: string) => {
    if (!systemCommands) {
      return Effect.succeed(undefined);
    }
    return Effect.gen(function* () {
      const error = yield* systemCommands.requiredCommandError(command);
      if (error !== null) {
        return yield* Effect.fail(
          new HostDependencyError({
            dependency: command,
            operation: "beadsTaskRepository.assertRequiredCommand",
            message: error,
          }),
        );
      }
    });
  };
  const trackOwnedSharedServer = (context: BeadsCliContext): BeadsCliContext => {
    if (context.sharedServer?.ownerPid === process.pid) {
      ownedSharedDoltServers.set(context.serverStatePath, context.sharedServer);
    }
    return context;
  };
  const trackCliContextResolution = (
    contextEffect: Effect.Effect<BeadsCliContext, TaskStoreError>,
  ): Effect.Effect<BeadsCliContext, TaskStoreError> =>
    Effect.gen(function* () {
      const flight = yield* Effect.forkDaemon(
        contextEffect.pipe(Effect.map(trackOwnedSharedServer)),
      );
      cliContextFlights.add(flight);
      return yield* Fiber.join(flight).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            cliContextFlights.delete(flight);
          }),
        ),
      );
    });
  const resolveContextRequest = (
    repoPath: string,
    options: Parameters<ResolveBeadsCliContext>[1] = {},
  ): Effect.Effect<CliContextRequest, TaskStoreError> =>
    Effect.gen(function* () {
      if (closing) {
        return yield* Effect.fail(
          new HostResourceError({
            resource: "beadsTaskStore",
            operation: "beadsTaskRepository.resolveContextRequest",
            message: "Beads task store is closing.",
          }),
        );
      }
      const configuredWorkspaceId =
        typeof options.workspaceId === "string" && options.workspaceId.trim().length > 0
          ? options.workspaceId.trim()
          : null;
      const cliOptions = { ...options, processEnv };
      if (closing) {
        return yield* Effect.fail(
          new HostResourceError({
            resource: "beadsTaskStore",
            operation: "beadsTaskRepository.resolveContextRequest",
            message: "Beads task store is closing.",
          }),
        );
      }
      const workspaceId = configuredWorkspaceId
        ? configuredWorkspaceId
        : resolveWorkspaceIdForRepoPath
          ? yield* resolveWorkspaceIdForRepoPath(repoPath)
          : null;
      if (closing) {
        return yield* Effect.fail(
          new HostResourceError({
            resource: "beadsTaskStore",
            operation: "beadsTaskRepository.resolveContextRequest",
            message: "Beads task store is closing.",
          }),
        );
      }
      const normalizedWorkspaceId =
        typeof workspaceId === "string" && workspaceId.trim().length > 0
          ? workspaceId.trim()
          : null;
      const effectiveOptions = normalizedWorkspaceId
        ? { ...cliOptions, workspaceId: normalizedWorkspaceId }
        : cliOptions;
      const cacheKey = `${repoPath}\0${normalizedWorkspaceId ?? ""}`;
      return {
        cacheKey,
        options: effectiveOptions,
      };
    });
  const resolveEffectiveCliContext: ResolveBeadsCliContext = (repoPath, options = {}) =>
    Effect.gen(function* () {
      const request = yield* resolveContextRequest(repoPath, options);
      if (options.requireSharedServer !== true) {
        return yield* trackCliContextResolution(resolveCliContext(repoPath, request.options));
      }
      const cached = readyCliContexts.get(request.cacheKey);
      if (cached) {
        return yield* Fiber.join(cached);
      }
      const tracked = yield* Effect.forkDaemon(
        resolveCliContext(repoPath, request.options).pipe(Effect.map(trackOwnedSharedServer)),
      );
      cliContextFlights.add(tracked);
      readyCliContexts.set(request.cacheKey, tracked);
      return yield* Fiber.join(tracked).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            if (readyCliContexts.get(request.cacheKey) === tracked) {
              readyCliContexts.delete(request.cacheKey);
            }
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            cliContextFlights.delete(tracked);
          }),
        ),
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
  const requireBdCommands = (requireSharedServer: boolean) =>
    Effect.gen(function* () {
      yield* assertRequiredCommand("bd");
      if (requireSharedServer) {
        yield* assertRequiredCommand("dolt");
      }
    });
  const runBdJsonForRepo = (repoPath: string) =>
    Effect.gen(function* () {
      if (runBdJson) {
        return effectiveRunBdJson;
      }
      yield* requireBdCommands(true);
      const context = yield* resolveEffectiveCliContext(repoPath, { requireSharedServer: true });
      return (commandRepoPath: string, args: string[]) =>
        effectiveRunBdJson(commandRepoPath, args, context);
    });
  const runBdForRepo = (repoPath: string) =>
    Effect.gen(function* () {
      if (runBd) {
        return effectiveRunBd;
      }
      yield* requireBdCommands(true);
      const context = yield* resolveEffectiveCliContext(repoPath, { requireSharedServer: true });
      return (commandRepoPath: string, args: string[]) =>
        effectiveRunBd(commandRepoPath, args, context);
    });
  const repository: BeadsTaskRepository = {
    close() {
      return Effect.gen(function* () {
        closing = true;
        yield* Effect.forEach([...cliContextFlights], Fiber.await, { concurrency: "unbounded" });
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
        const cached = taskListCache.cachedTaskListAndGeneration(repoPath, doneVisibleDays);
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
        yield* requireBdCommands(prepare);
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
