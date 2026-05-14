import type { TaskCard } from "@openducktor/contracts";
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
  RunBd,
  RunBdJson,
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
import {
  type BeadsCliContext,
  resolveBeadsCliContext,
  stopOwnedSharedDoltServer,
} from "./beads-cli-context";

export type { BeadsTaskRepository } from "../../infrastructure/beads/task-store/beads-raw-issue";

const TASK_LIST_CACHE_TTL_MS = 2_000;

type TaskListCacheEntry = {
  cachedAt: number;
  tasks: TaskCard[];
};

type TaskListCacheState = {
  entry: TaskListCacheEntry | null;
  generation: number;
  repoPath: string;
};

type CliContextRequest = {
  cacheKey: string;
  options: Parameters<ResolveBeadsCliContext>[1];
};

const cloneTasks = (tasks: TaskCard[]): TaskCard[] =>
  tasks.map((task) => structuredClone(task) as TaskCard);

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
  const cliContextFlights = new Set<Promise<BeadsCliContext>>();
  const readyCliContexts = new Map<string, Promise<BeadsCliContext>>();
  const taskListCache = new Map<string, TaskListCacheState>();
  let closing = false;

  const taskListCacheKey = (repoPath: string, doneVisibleDays: number | undefined): string =>
    `${repoPath}\0${doneVisibleDays === undefined ? "all" : doneVisibleDays.toString()}`;

  const taskListCacheState = (
    repoPath: string,
    doneVisibleDays: number | undefined,
  ): TaskListCacheState => {
    const key = taskListCacheKey(repoPath, doneVisibleDays);
    const existing = taskListCache.get(key);
    if (existing) {
      return existing;
    }

    const state: TaskListCacheState = {
      entry: null,
      generation: 0,
      repoPath,
    };
    taskListCache.set(key, state);
    return state;
  };

  const cachedTaskListAndGeneration = (
    repoPath: string,
    doneVisibleDays: number | undefined,
  ): { generation: number; tasks: TaskCard[] | null } => {
    const state = taskListCacheState(repoPath, doneVisibleDays);
    if (state.entry && Date.now() - state.entry.cachedAt <= TASK_LIST_CACHE_TTL_MS) {
      return { generation: state.generation, tasks: cloneTasks(state.entry.tasks) };
    }

    state.entry = null;
    return { generation: state.generation, tasks: null };
  };

  const cacheTaskListIfGeneration = (
    repoPath: string,
    doneVisibleDays: number | undefined,
    generation: number,
    tasks: TaskCard[],
  ): void => {
    const state = taskListCacheState(repoPath, doneVisibleDays);
    if (state.generation !== generation) {
      return;
    }

    state.entry = {
      cachedAt: Date.now(),
      tasks: cloneTasks(tasks),
    };
  };

  const invalidateTaskListCache = (repoPath: string): void => {
    for (const state of taskListCache.values()) {
      if (state.repoPath !== repoPath) {
        continue;
      }
      state.generation += 1;
      state.entry = null;
    }
  };

  const assertRequiredCommand = async (command: string): Promise<void> => {
    if (!systemCommands) {
      return;
    }

    const error = await systemCommands.requiredCommandError(command);
    if (error !== null) {
      throw new Error(error);
    }
  };

  const trackOwnedSharedServer = (context: BeadsCliContext): BeadsCliContext => {
    if (context.sharedServer?.ownerPid === process.pid) {
      ownedSharedDoltServers.set(context.serverStatePath, context.sharedServer);
    }
    return context;
  };

  const trackCliContextResolution = (
    contextPromise: Promise<BeadsCliContext>,
  ): Promise<BeadsCliContext> => {
    const flight = contextPromise.then(trackOwnedSharedServer);
    cliContextFlights.add(flight);
    return flight.finally(() => {
      cliContextFlights.delete(flight);
    });
  };

  const resolveContextRequest = async (
    repoPath: string,
    options: Parameters<ResolveBeadsCliContext>[1] = {},
  ): Promise<CliContextRequest> => {
    if (closing) {
      throw new Error("Beads task store is closing.");
    }
    const configuredWorkspaceId =
      typeof options.workspaceId === "string" && options.workspaceId.trim().length > 0
        ? options.workspaceId.trim()
        : null;
    const cliOptions = { ...options, processEnv };
    await assertRequiredCommand("bd");
    if (cliOptions.requireSharedServer === true) {
      await assertRequiredCommand("dolt");
    }
    if (closing) {
      throw new Error("Beads task store is closing.");
    }

    const workspaceId = configuredWorkspaceId
      ? configuredWorkspaceId
      : resolveWorkspaceIdForRepoPath
        ? await resolveWorkspaceIdForRepoPath(repoPath)
        : null;
    if (closing) {
      throw new Error("Beads task store is closing.");
    }
    const normalizedWorkspaceId =
      typeof workspaceId === "string" && workspaceId.trim().length > 0 ? workspaceId.trim() : null;
    const effectiveOptions = normalizedWorkspaceId
      ? { ...cliOptions, workspaceId: normalizedWorkspaceId }
      : cliOptions;
    const cacheKey = `${repoPath}\0${normalizedWorkspaceId ?? ""}`;

    return {
      cacheKey,
      options: effectiveOptions,
    };
  };

  const resolveEffectiveCliContext: ResolveBeadsCliContext = async (repoPath, options = {}) => {
    const request = await resolveContextRequest(repoPath, options);
    if (options.requireSharedServer !== true) {
      return trackCliContextResolution(resolveCliContext(repoPath, request.options));
    }

    const cached = readyCliContexts.get(request.cacheKey);
    if (cached) {
      return cached;
    }

    const tracked = trackCliContextResolution(resolveCliContext(repoPath, request.options));
    readyCliContexts.set(request.cacheKey, tracked);
    tracked.catch(() => {
      if (readyCliContexts.get(request.cacheKey) === tracked) {
        readyCliContexts.delete(request.cacheKey);
      }
    });
    return tracked;
  };
  const effectiveRunBd = runBd ?? defaultRunBd(resolveEffectiveCliContext);
  const effectiveRunBdJson = runBdJson ?? defaultRunBdJson(resolveEffectiveCliContext);

  const runBdJsonForRepo = async (repoPath: string): Promise<RunBdJson> => {
    if (runBdJson) {
      return effectiveRunBdJson;
    }
    const context = await resolveEffectiveCliContext(repoPath, { requireSharedServer: true });
    return (commandRepoPath, args) => effectiveRunBdJson(commandRepoPath, args, context);
  };

  const runBdForRepo = async (repoPath: string): Promise<RunBd> => {
    if (runBd) {
      return effectiveRunBd;
    }
    const context = await resolveEffectiveCliContext(repoPath, { requireSharedServer: true });
    return (commandRepoPath, args) => effectiveRunBd(commandRepoPath, args, context);
  };

  return {
    async close() {
      closing = true;
      await Promise.allSettled([...cliContextFlights]);
      const errors: string[] = [];
      let stoppedSharedDoltServers = 0;
      for (const [serverStatePath, sharedServer] of ownedSharedDoltServers) {
        if (!sharedServer) {
          continue;
        }
        try {
          await stopSharedDoltServer(sharedServer, serverStatePath);
          stoppedSharedDoltServers += 1;
          ownedSharedDoltServers.delete(serverStatePath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`Failed stopping shared Dolt server ${sharedServer.pid}: ${message}`);
        }
      }
      if (errors.length > 0) {
        throw new Error(errors.join("\n"));
      }
      return { stoppedSharedDoltServers };
    },
    async listTasks({ repoPath, doneVisibleDays }) {
      const cached = cachedTaskListAndGeneration(repoPath, doneVisibleDays);
      if (cached.tasks) {
        return cached.tasks;
      }

      const tasks = await listTasksWithBd(
        await runBdJsonForRepo(repoPath),
        now,
        repoPath,
        doneVisibleDays,
      );
      cacheTaskListIfGeneration(repoPath, doneVisibleDays, cached.generation, tasks);
      return cloneTasks(tasks);
    },
    async getTask({ repoPath, taskId }) {
      return getTaskWithBd(await runBdJsonForRepo(repoPath), repoPath, taskId);
    },
    async getTaskMetadata({ repoPath, taskId }) {
      return getTaskMetadataWithBd(await runBdJsonForRepo(repoPath), repoPath, taskId);
    },
    diagnoseRepoStore({ repoPath, prepare = false }) {
      return diagnoseRepoStoreWithBd(
        effectiveRunBdJson,
        repoPath,
        resolveEffectiveCliContext,
        prepare,
      );
    },
    async listPullRequestSyncCandidates({ repoPath }) {
      return listPullRequestSyncCandidatesWithBd(await runBdJsonForRepo(repoPath), now, repoPath);
    },
    async setSpecDocument({ repoPath, taskId, markdown }) {
      const runBdJsonForOperation = await runBdJsonForRepo(repoPath);
      const document = await writeDocumentWithBd(
        runBdJsonForOperation,
        now,
        repoPath,
        taskId,
        markdown,
        "spec",
      );
      invalidateTaskListCache(repoPath);
      return document;
    },
    async setPlanDocument({ repoPath, taskId, markdown }) {
      const runBdJsonForOperation = await runBdJsonForRepo(repoPath);
      const document = await writeDocumentWithBd(
        runBdJsonForOperation,
        now,
        repoPath,
        taskId,
        markdown,
        "implementationPlan",
      );
      invalidateTaskListCache(repoPath);
      return document;
    },
    async recordQaOutcome({ repoPath, taskId, status, markdown, verdict }) {
      const runBdJsonForOperation = await runBdJsonForRepo(repoPath);
      const task = await recordQaOutcomeWithBd(
        runBdJsonForOperation,
        now,
        repoPath,
        taskId,
        status,
        markdown,
        verdict,
      );
      invalidateTaskListCache(repoPath);
      return task;
    },
    async upsertAgentSession({ repoPath, taskId, session }) {
      const updated = await upsertAgentSessionWithBd(
        await runBdJsonForRepo(repoPath),
        repoPath,
        taskId,
        session,
      );
      invalidateTaskListCache(repoPath);
      return updated;
    },
    async setPullRequest({ repoPath, taskId, pullRequest }) {
      const updated = await setPullRequestWithBd(
        await runBdJsonForRepo(repoPath),
        repoPath,
        taskId,
        pullRequest,
      );
      invalidateTaskListCache(repoPath);
      return updated;
    },
    async setDirectMerge({ repoPath, taskId, directMerge }) {
      const updated = await setDirectMergeWithBd(
        await runBdJsonForRepo(repoPath),
        repoPath,
        taskId,
        directMerge,
      );
      invalidateTaskListCache(repoPath);
      return updated;
    },
    async clearAgentSessionsByRoles({ repoPath, taskId, roles }) {
      const updated = await clearAgentSessionsByRolesWithBd(
        await runBdJsonForRepo(repoPath),
        repoPath,
        taskId,
        roles,
      );
      invalidateTaskListCache(repoPath);
      return updated;
    },
    async clearWorkflowDocuments({ repoPath, taskId }) {
      const updated = await clearWorkflowDocumentsWithBd(
        await runBdJsonForRepo(repoPath),
        repoPath,
        taskId,
      );
      invalidateTaskListCache(repoPath);
      return updated;
    },
    async clearQaReports({ repoPath, taskId }) {
      const updated = await clearQaReportsWithBd(
        await runBdJsonForRepo(repoPath),
        repoPath,
        taskId,
      );
      invalidateTaskListCache(repoPath);
      return updated;
    },
    async createTask({ repoPath, task }) {
      const created = await createTaskWithBd(await runBdJsonForRepo(repoPath), repoPath, task);
      invalidateTaskListCache(repoPath);
      return created;
    },
    async updateTask({ repoPath, taskId, patch }) {
      const updated = await updateTaskWithBd(
        await runBdJsonForRepo(repoPath),
        repoPath,
        taskId,
        patch,
      );
      invalidateTaskListCache(repoPath);
      return updated;
    },
    async transitionTask({ repoPath, taskId, status }) {
      const updated = await transitionTaskWithBd(
        await runBdJsonForRepo(repoPath),
        repoPath,
        taskId,
        status,
      );
      invalidateTaskListCache(repoPath);
      return updated;
    },
    async deleteTask({ repoPath, taskId, deleteSubtasks }) {
      const deleted = await deleteTaskWithBd(
        await runBdForRepo(repoPath),
        repoPath,
        taskId,
        deleteSubtasks,
      );
      invalidateTaskListCache(repoPath);
      return deleted;
    },
  };
};
