import { BeadsPersistence, type TaskPersistencePort } from "./beads-persistence";
import { nowIso, type TimeProvider } from "./beads-runtime";
import { BeadsRuntimeClient, type BeadsRuntimeClientDeps } from "./beads-runtime-client";
import { EpicSubtaskReplacementService } from "./epic-subtask-replacement";
import { createSubtask, deleteTaskById } from "./epic-subtasks";
import {
  createOdtTaskStoreUseCases,
  type OdtTaskStoreUseCase,
  type OdtTaskStoreUseCases,
} from "./odt-task-store-use-cases";
import type { OdtStoreOptions } from "./store-context";
import { type TaskDocumentPort, TaskDocumentStore } from "./task-document-store";
import { TaskIndexCache } from "./task-index-cache";
import { createOdtTaskWorkflowRuntime } from "./task-workflow-runtime";
import {
  BuildBlockedInputSchema,
  BuildCompletedInputSchema,
  BuildResumedInputSchema,
  CreateTaskInputSchema,
  QaApprovedInputSchema,
  QaRejectedInputSchema,
  ReadTaskInputSchema,
  SearchTasksInputSchema,
  SetPlanInputSchema,
  SetSpecInputSchema,
} from "./tool-schemas";

export type OdtTaskStoreDeps = {
  runProcess?: BeadsRuntimeClientDeps["runProcess"];
  resolveBeadsDir?: BeadsRuntimeClientDeps["resolveBeadsDir"];
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
      taskLookup: taskIndexCache,
    });
    this.useCases = createOdtTaskStoreUseCases({
      persistence,
      workflow,
      documentStore,
      epicSubtaskReplacementService,
      invalidateTaskIndex: () => taskIndexCache.invalidate(),
    });
  }

  private createDefaultPersistence(
    options: OdtStoreOptions,
    deps: OdtTaskStoreDeps,
  ): BeadsPersistence {
    const beadsClient = new BeadsRuntimeClient(this.repoPath, options.beadsDir ?? null, {
      ...(deps.runProcess ? { runProcess: deps.runProcess } : {}),
      ...(deps.resolveBeadsDir ? { resolveBeadsDir: deps.resolveBeadsDir } : {}),
    });
    return new BeadsPersistence(beadsClient, options.metadataNamespace);
  }

  private executeUseCase<Input, Output>(
    rawInput: unknown,
    schema: { parse: (input: unknown) => Input },
    useCase: OdtTaskStoreUseCase<Input, Output>,
  ): Promise<Output> {
    return useCase.execute(schema.parse(rawInput));
  }

  async readTask(
    rawInput: unknown,
  ): Promise<Awaited<ReturnType<OdtTaskStoreUseCases["readTask"]["execute"]>>> {
    return this.executeUseCase(rawInput, ReadTaskInputSchema, this.useCases.readTask);
  }

  async createTask(
    rawInput: unknown,
  ): Promise<Awaited<ReturnType<OdtTaskStoreUseCases["createTask"]["execute"]>>> {
    return this.executeUseCase(rawInput, CreateTaskInputSchema, this.useCases.createTask);
  }

  async searchTasks(
    rawInput: unknown,
  ): Promise<Awaited<ReturnType<OdtTaskStoreUseCases["searchTasks"]["execute"]>>> {
    return this.executeUseCase(rawInput, SearchTasksInputSchema, this.useCases.searchTasks);
  }

  async setSpec(
    rawInput: unknown,
  ): Promise<Awaited<ReturnType<OdtTaskStoreUseCases["setSpec"]["execute"]>>> {
    return this.executeUseCase(rawInput, SetSpecInputSchema, this.useCases.setSpec);
  }

  async setPlan(
    rawInput: unknown,
  ): Promise<Awaited<ReturnType<OdtTaskStoreUseCases["setPlan"]["execute"]>>> {
    return this.executeUseCase(rawInput, SetPlanInputSchema, this.useCases.setPlan);
  }

  async buildBlocked(
    rawInput: unknown,
  ): Promise<Awaited<ReturnType<OdtTaskStoreUseCases["buildBlocked"]["execute"]>>> {
    return this.executeUseCase(rawInput, BuildBlockedInputSchema, this.useCases.buildBlocked);
  }

  async buildResumed(
    rawInput: unknown,
  ): Promise<Awaited<ReturnType<OdtTaskStoreUseCases["buildResumed"]["execute"]>>> {
    return this.executeUseCase(rawInput, BuildResumedInputSchema, this.useCases.buildResumed);
  }

  async buildCompleted(
    rawInput: unknown,
  ): Promise<Awaited<ReturnType<OdtTaskStoreUseCases["buildCompleted"]["execute"]>>> {
    return this.executeUseCase(rawInput, BuildCompletedInputSchema, this.useCases.buildCompleted);
  }

  async qaApproved(
    rawInput: unknown,
  ): Promise<Awaited<ReturnType<OdtTaskStoreUseCases["qaApproved"]["execute"]>>> {
    return this.executeUseCase(rawInput, QaApprovedInputSchema, this.useCases.qaApproved);
  }

  async qaRejected(
    rawInput: unknown,
  ): Promise<Awaited<ReturnType<OdtTaskStoreUseCases["qaRejected"]["execute"]>>> {
    return this.executeUseCase(rawInput, QaRejectedInputSchema, this.useCases.qaRejected);
  }
}
