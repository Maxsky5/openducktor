import { Clock, Effect } from "effect";
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
import { createBdCommandProvider } from "./bd-command-provider";
import { createBeadsCliContextManager } from "./beads-cli-context-manager";
import { cloneTasks, createTaskListCache } from "./beads-task-list-cache";
import { mapTaskStoreErrors } from "./beads-task-store-errors";

export type { BeadsTaskRepository } from "../../infrastructure/beads/task-store/beads-raw-issue";

export const createBeadsTaskRepository = ({
  now = () => new Date(),
  processEnv = process.env,
  runBd,
  runBdJson,
  resolveCliContext,
  resolveWorkspaceIdForRepoPath,
  stopSharedDoltServer,
  toolDiscovery,
}: CreateBeadsTaskRepositoryInput): BeadsTaskRepository => {
  const taskListCache = createTaskListCache();
  const cliContextManager = createBeadsCliContextManager({
    processEnv,
    toolDiscovery,
    ...(resolveCliContext === undefined ? {} : { resolveCliContext }),
    ...(stopSharedDoltServer === undefined ? {} : { stopSharedDoltServer }),
    ...(resolveWorkspaceIdForRepoPath === undefined ? {} : { resolveWorkspaceIdForRepoPath }),
  });
  const commandProvider = createBdCommandProvider({
    resolveCliContext: cliContextManager.resolveCliContext,
    ...(runBd === undefined ? {} : { runBd }),
    ...(runBdJson === undefined ? {} : { runBdJson }),
  });
  const repository: BeadsTaskRepository = {
    close() {
      return cliContextManager.close();
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
        const runBdJsonForOperation = yield* commandProvider.runBdJsonForRepo(repoPath);
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
        const runBdJsonForOperation = yield* commandProvider.runBdJsonForRepo(repoPath);
        return yield* getTaskWithBd(runBdJsonForOperation, repoPath, taskId);
      });
    },
    getTaskMetadata({ repoPath, taskId }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* commandProvider.runBdJsonForRepo(repoPath);
        return yield* getTaskMetadataWithBd(runBdJsonForOperation, repoPath, taskId);
      });
    },
    diagnoseRepoStore({ repoPath, prepare = false }) {
      return Effect.gen(function* () {
        return yield* diagnoseRepoStoreWithBd(
          commandProvider.runBdJson,
          repoPath,
          commandProvider.resolveCliContext,
          prepare,
        );
      });
    },
    listPullRequestSyncCandidates({ repoPath }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* commandProvider.runBdJsonForRepo(repoPath);
        return yield* listPullRequestSyncCandidatesWithBd(runBdJsonForOperation, now, repoPath);
      });
    },
    setSpecDocument({ repoPath, taskId, markdown }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* commandProvider.runBdJsonForRepo(repoPath);
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
        const runBdJsonForOperation = yield* commandProvider.runBdJsonForRepo(repoPath);
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
        const runBdJsonForOperation = yield* commandProvider.runBdJsonForRepo(repoPath);
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
        const runBdJsonForOperation = yield* commandProvider.runBdJsonForRepo(repoPath);
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
        const runBdJsonForOperation = yield* commandProvider.runBdJsonForRepo(repoPath);
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
        const runBdJsonForOperation = yield* commandProvider.runBdJsonForRepo(repoPath);
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
        const runBdJsonForOperation = yield* commandProvider.runBdJsonForRepo(repoPath);
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
        const runBdJsonForOperation = yield* commandProvider.runBdJsonForRepo(repoPath);
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
        const runBdJsonForOperation = yield* commandProvider.runBdJsonForRepo(repoPath);
        const updated = yield* clearQaReportsWithBd(runBdJsonForOperation, repoPath, taskId);
        taskListCache.invalidateTaskListCache(repoPath);
        return updated;
      });
    },
    createTask({ repoPath, task }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* commandProvider.runBdJsonForRepo(repoPath);
        const created = yield* createTaskWithBd(runBdJsonForOperation, repoPath, task);
        taskListCache.invalidateTaskListCache(repoPath);
        return created;
      });
    },
    updateTask({ repoPath, taskId, patch }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* commandProvider.runBdJsonForRepo(repoPath);
        const updated = yield* updateTaskWithBd(runBdJsonForOperation, repoPath, taskId, patch);
        taskListCache.invalidateTaskListCache(repoPath);
        return updated;
      });
    },
    transitionTask({ repoPath, taskId, status }) {
      return Effect.gen(function* () {
        const runBdJsonForOperation = yield* commandProvider.runBdJsonForRepo(repoPath);
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
        const runBdForOperation = yield* commandProvider.runBdForRepo(repoPath);
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
