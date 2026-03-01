import { BdPersistence, type TaskPersistencePort } from "./bd-persistence";
import { BdRuntimeClient, type BdRuntimeClientDeps } from "./bd-runtime-client";
import { nowIso, type TimeProvider } from "./beads-runtime";
import type { TaskCard, TaskStatus } from "./contracts";
import { EpicSubtaskReplacementService } from "./epic-subtask-replacement";
import { createSubtask, deleteTaskById } from "./epic-subtasks";
import { normalizePlanSubtasks } from "./plan-subtasks";
import type { OdtStoreOptions } from "./store-context";
import { type TaskDocumentPort, TaskDocumentStore } from "./task-document-store";
import { TaskIndexCache } from "./task-index-cache";
import { issueToTaskCard } from "./task-mapping";
import {
  assertTransitionAllowed as assertTaskTransitionAllowed,
  refreshTaskContext,
  resolveTaskContext,
  type TaskContext,
  transitionTask,
} from "./task-transitions";
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
import {
  assertNoValidationError,
  getSetPlanError,
  getSetSpecError,
  validatePlanSubtaskRules,
} from "./workflow-policy";

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
  private readonly persistence: TaskPersistencePort;
  private readonly documentStore: TaskDocumentPort;
  private readonly taskIndexCache: TaskIndexCache;
  private readonly epicSubtaskReplacementService: EpicSubtaskReplacementService;

  constructor(options: OdtStoreOptions, deps: OdtTaskStoreDeps = {}) {
    this.repoPath = options.repoPath;
    this.persistence = deps.persistence ?? this.createDefaultPersistence(options, deps);
    this.metadataNamespace = this.persistence.metadataNamespace;
    this.documentStore =
      deps.documentStore ?? new TaskDocumentStore(this.persistence, deps.now ?? nowIso);
    this.taskIndexCache =
      deps.taskIndexCache ?? new TaskIndexCache(() => this.persistence.listTasks());
    this.epicSubtaskReplacementService =
      deps.epicSubtaskReplacementService ??
      new EpicSubtaskReplacementService({
        listTasks: () => this.persistence.listTasks(),
        createSubtask: async (parentTaskId, subtask) =>
          createSubtask(
            parentTaskId,
            subtask,
            (args) => this.persistence.runBdJson(args),
            () => this.taskIndexCache.invalidate(),
          ),
        deleteTask: async (taskId) =>
          deleteTaskById(
            taskId,
            (args) => this.persistence.runBdJson(args),
            () => this.taskIndexCache.invalidate(),
            false,
          ),
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

  private async resolveTaskContext(taskId: string): Promise<TaskContext> {
    return resolveTaskContext(taskId, () => this.persistence.listTasks());
  }

  private async refreshTaskContext(taskId: string, context?: TaskContext): Promise<TaskContext> {
    return refreshTaskContext({
      taskId,
      ...(context ? { context } : {}),
      showRawIssue: (id) => this.persistence.showRawIssue(id),
      metadataNamespace: this.metadataNamespace,
    });
  }

  private assertTransitionAllowed(task: TaskCard, tasks: TaskCard[], nextStatus: TaskStatus): void {
    assertTaskTransitionAllowed(task, tasks, nextStatus);
  }

  private async transitionTask(
    taskId: string,
    nextStatus: TaskStatus,
    context?: TaskContext,
  ): Promise<TaskCard> {
    return transitionTask({
      taskId,
      nextStatus,
      ...(context ? { context } : {}),
      listTasks: () => this.persistence.listTasks(),
      runBdJson: (args) => this.persistence.runBdJson(args),
      showRawIssue: (id) => this.persistence.showRawIssue(id),
      invalidateTaskIndex: () => this.taskIndexCache.invalidate(),
      metadataNamespace: this.metadataNamespace,
    });
  }

  async readTask(rawInput: unknown): Promise<unknown> {
    await this.persistence.ensureInitialized();
    const input = ReadTaskInputSchema.parse(rawInput);
    const task = await this.taskIndexCache.resolveTask(input.taskId);

    const issue = await this.persistence.showRawIssue(task.id);
    const taskCard = issueToTaskCard(issue, this.metadataNamespace);
    const docs = this.documentStore.parseDocs(issue);

    return {
      task: taskCard,
      documents: docs,
    };
  }

  async setSpec(rawInput: unknown): Promise<unknown> {
    await this.persistence.ensureInitialized();
    const input = SetSpecInputSchema.parse(rawInput);
    const markdown = input.markdown.trim();

    const context = await this.resolveTaskContext(input.taskId);
    const { task } = context;
    assertNoValidationError(getSetSpecError(task.status));

    const persistedDocument = await this.documentStore.persistSpec(task.id, markdown);

    let nextTask: TaskCard = task;
    if (task.status === "open") {
      const refreshedContext = await this.refreshTaskContext(task.id, context);
      nextTask = await this.transitionTask(task.id, "spec_ready", refreshedContext);
    }

    return {
      task: nextTask,
      document: {
        markdown,
        updatedAt: persistedDocument.updatedAt,
        revision: persistedDocument.revision,
      },
    };
  }

  async setPlan(rawInput: unknown): Promise<unknown> {
    await this.persistence.ensureInitialized();
    const input = SetPlanInputSchema.parse(rawInput);
    const markdown = input.markdown.trim();

    const context = await this.resolveTaskContext(input.taskId);
    const { task, tasks } = context;

    const normalizedSubtasks = normalizePlanSubtasks(input.subtasks ?? []);
    let persistedDocument: { updatedAt: string; revision: number };
    let createdSubtaskIds: string[] = [];
    if (task.issueType === "epic") {
      // Epic subtask replacement must validate against a fresh snapshot, not the initial context.
      const epicReplacement = await this.epicSubtaskReplacementService.prepareReplacement(
        task,
        normalizedSubtasks,
      );
      persistedDocument = await this.documentStore.persistImplementationPlan(task.id, markdown);
      createdSubtaskIds = await this.epicSubtaskReplacementService.applyReplacement(
        epicReplacement.latestTask,
        epicReplacement.existingDirectSubtasks,
        normalizedSubtasks,
      );
    } else {
      assertNoValidationError(getSetPlanError(task));
      validatePlanSubtaskRules(task, tasks, normalizedSubtasks);
      persistedDocument = await this.documentStore.persistImplementationPlan(task.id, markdown);
    }

    const refreshedTransitionContext = await this.refreshTaskContext(task.id, context);
    const nextTask = await this.transitionTask(
      task.id,
      "ready_for_dev",
      refreshedTransitionContext,
    );

    return {
      task: nextTask,
      document: {
        markdown,
        updatedAt: persistedDocument.updatedAt,
        revision: persistedDocument.revision,
      },
      createdSubtaskIds,
    };
  }

  async buildBlocked(rawInput: unknown): Promise<unknown> {
    await this.persistence.ensureInitialized();
    const input = BuildBlockedInputSchema.parse(rawInput);
    const task = await this.transitionTask(input.taskId, "blocked");
    return {
      task,
      reason: input.reason,
    };
  }

  async buildResumed(rawInput: unknown): Promise<unknown> {
    await this.persistence.ensureInitialized();
    const input = BuildResumedInputSchema.parse(rawInput);
    const task = await this.transitionTask(input.taskId, "in_progress");
    return { task };
  }

  async buildCompleted(rawInput: unknown): Promise<unknown> {
    await this.persistence.ensureInitialized();
    const input = BuildCompletedInputSchema.parse(rawInput);

    const context = await this.resolveTaskContext(input.taskId);
    const refreshedContext = await this.refreshTaskContext(context.task.id, context);
    const { task } = refreshedContext;

    const nextStatus: TaskStatus = task.aiReviewEnabled ? "ai_review" : "human_review";
    const updated = await this.transitionTask(task.id, nextStatus, refreshedContext);
    return {
      task: updated,
      ...(input.summary ? { summary: input.summary } : {}),
    };
  }

  async qaApproved(rawInput: unknown): Promise<unknown> {
    await this.persistence.ensureInitialized();
    const input = QaApprovedInputSchema.parse(rawInput);
    const context = await this.resolveTaskContext(input.taskId);
    const { task, tasks } = context;
    this.assertTransitionAllowed(task, tasks, "human_review");
    await this.documentStore.appendQaReport(task.id, input.reportMarkdown.trim(), "approved");
    const refreshedContext = await this.refreshTaskContext(task.id, context);
    const updated = await this.transitionTask(task.id, "human_review", refreshedContext);
    return { task: updated };
  }

  async qaRejected(rawInput: unknown): Promise<unknown> {
    await this.persistence.ensureInitialized();
    const input = QaRejectedInputSchema.parse(rawInput);
    const context = await this.resolveTaskContext(input.taskId);
    const { task, tasks } = context;
    this.assertTransitionAllowed(task, tasks, "in_progress");
    await this.documentStore.appendQaReport(task.id, input.reportMarkdown.trim(), "rejected");
    const refreshedContext = await this.refreshTaskContext(task.id, context);
    const updated = await this.transitionTask(task.id, "in_progress", refreshedContext);
    return { task: updated };
  }
}
