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
import {
  BuildBlockedInputSchema,
  BuildCompletedInputSchema,
  BuildResumedInputSchema,
  QaApprovedInputSchema,
  QaRejectedInputSchema,
  ReadTaskInputSchema,
  SetPlanInputSchema,
  SetSpecInputSchema,
} from "./tool-schemas";

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
      taskLookup: taskIndexCache,
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

  async readTask(
    rawInput: unknown,
  ): Promise<Awaited<ReturnType<OdtTaskStoreUseCases["readTask"]["execute"]>>> {
    return this.useCases.readTask.execute(ReadTaskInputSchema.parse(rawInput));
  }

  async setSpec(
    rawInput: unknown,
  ): Promise<Awaited<ReturnType<OdtTaskStoreUseCases["setSpec"]["execute"]>>> {
    return this.useCases.setSpec.execute(SetSpecInputSchema.parse(rawInput));
  }

  async setPlan(
    rawInput: unknown,
  ): Promise<Awaited<ReturnType<OdtTaskStoreUseCases["setPlan"]["execute"]>>> {
    return this.useCases.setPlan.execute(SetPlanInputSchema.parse(rawInput));
  }

  async buildBlocked(
    rawInput: unknown,
  ): Promise<Awaited<ReturnType<OdtTaskStoreUseCases["buildBlocked"]["execute"]>>> {
    return this.useCases.buildBlocked.execute(BuildBlockedInputSchema.parse(rawInput));
  }

  async buildResumed(
    rawInput: unknown,
  ): Promise<Awaited<ReturnType<OdtTaskStoreUseCases["buildResumed"]["execute"]>>> {
    return this.useCases.buildResumed.execute(BuildResumedInputSchema.parse(rawInput));
  }

  async buildCompleted(
    rawInput: unknown,
  ): Promise<Awaited<ReturnType<OdtTaskStoreUseCases["buildCompleted"]["execute"]>>> {
    return this.useCases.buildCompleted.execute(BuildCompletedInputSchema.parse(rawInput));
  }

  async qaApproved(
    rawInput: unknown,
  ): Promise<Awaited<ReturnType<OdtTaskStoreUseCases["qaApproved"]["execute"]>>> {
    return this.useCases.qaApproved.execute(QaApprovedInputSchema.parse(rawInput));
  }

  async qaRejected(
    rawInput: unknown,
  ): Promise<Awaited<ReturnType<OdtTaskStoreUseCases["qaRejected"]["execute"]>>> {
    return this.useCases.qaRejected.execute(QaRejectedInputSchema.parse(rawInput));
  }
}
