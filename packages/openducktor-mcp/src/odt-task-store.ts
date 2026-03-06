import { BdPersistence, type TaskPersistencePort } from "./bd-persistence";
import { BdRuntimeClient, type BdRuntimeClientDeps } from "./bd-runtime-client";
import { nowIso, type TimeProvider } from "./beads-runtime";
import { EpicSubtaskReplacementService } from "./epic-subtask-replacement";
import { createSubtask, deleteTaskById } from "./epic-subtasks";
import { createOdtTaskStoreUseCases, type OdtTaskStoreUseCases } from "./odt-task-store-use-cases";
import type { OdtStoreOptions } from "./store-context";
import { type TaskDocumentPort, TaskDocumentStore } from "./task-document-store";
import { TaskIndexCache } from "./task-index-cache";
import { createOdtTaskWorkflowRuntime } from "./task-workflow-runtime";

export type OdtTaskStoreDeps = {
  runProcess?: BdRuntimeClientDeps["runProcess"];
  resolveBeadsDir?: BdRuntimeClientDeps["resolveBeadsDir"];
  now?: TimeProvider;
  persistence?: TaskPersistencePort;
  documentStore?: TaskDocumentPort;
  taskIndexCache?: TaskIndexCache;
  epicSubtaskReplacementService?: EpicSubtaskReplacementService;
};

export class OdtTaskStore {
  readonly repoPath: string;
  readonly metadataNamespace: string;
  private readonly useCases: OdtTaskStoreUseCases;

  constructor(options: OdtStoreOptions, deps: OdtTaskStoreDeps = {}) {
    this.repoPath = options.repoPath;
    const persistence = deps.persistence ?? this.createDefaultPersistence(options, deps);
    const documentStore =
      deps.documentStore ?? new TaskDocumentStore(persistence, deps.now ?? nowIso);
    const taskIndexCache = deps.taskIndexCache ?? new TaskIndexCache(() => persistence.listTasks());
    const epicSubtaskReplacementService =
      deps.epicSubtaskReplacementService ??
      new EpicSubtaskReplacementService({
        listTasks: () => persistence.listTasks(),
        createSubtask: async (parentTaskId, subtask) =>
          createSubtask(
            parentTaskId,
            subtask,
            (args) => persistence.runBdJson(args),
            () => taskIndexCache.invalidate(),
          ),
        deleteTask: async (taskId) =>
          deleteTaskById(
            taskId,
            (args) => persistence.runBdJson(args),
            () => taskIndexCache.invalidate(),
            false,
          ),
      });
    this.metadataNamespace = persistence.metadataNamespace;
    const workflow = createOdtTaskWorkflowRuntime({
      persistence,
      taskIndexCache,
    });
    this.useCases = createOdtTaskStoreUseCases({
      workflow,
      documentStore,
      epicSubtaskReplacementService,
    });
  }

  private createDefaultPersistence(
    options: OdtStoreOptions,
    deps: OdtTaskStoreDeps,
  ): BdPersistence {
    const bdClient = new BdRuntimeClient(this.repoPath, options.beadsDir ?? null, {
      ...(deps.runProcess ? { runProcess: deps.runProcess } : {}),
      ...(deps.resolveBeadsDir ? { resolveBeadsDir: deps.resolveBeadsDir } : {}),
    });
    return new BdPersistence(bdClient, options.metadataNamespace);
  }

  async readTask(rawInput: unknown): Promise<unknown> {
    return this.useCases.readTask.execute(rawInput);
  }

  async setSpec(rawInput: unknown): Promise<unknown> {
    return this.useCases.setSpec.execute(rawInput);
  }

  async setPlan(rawInput: unknown): Promise<unknown> {
    return this.useCases.setPlan.execute(rawInput);
  }

  async buildBlocked(rawInput: unknown): Promise<unknown> {
    return this.useCases.buildBlocked.execute(rawInput);
  }

  async buildResumed(rawInput: unknown): Promise<unknown> {
    return this.useCases.buildResumed.execute(rawInput);
  }

  async buildCompleted(rawInput: unknown): Promise<unknown> {
    return this.useCases.buildCompleted.execute(rawInput);
  }

  async qaApproved(rawInput: unknown): Promise<unknown> {
    return this.useCases.qaApproved.execute(rawInput);
  }

  async qaRejected(rawInput: unknown): Promise<unknown> {
    return this.useCases.qaRejected.execute(rawInput);
  }
}
