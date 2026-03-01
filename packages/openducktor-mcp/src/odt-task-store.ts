import { BdPersistence } from "./bd-persistence";
import { BdRuntimeClient, type BdRuntimeClientDeps } from "./bd-runtime-client";
import { nowIso, type TimeProvider } from "./beads-runtime";
import type { PlanSubtaskInput, TaskCard, TaskStatus } from "./contracts";
import { createSubtask, deleteTaskById } from "./epic-subtasks";
import { normalizePlanSubtasks } from "./plan-subtasks";
import type { OdtStoreOptions } from "./store-context";
import { TaskDocumentStore } from "./task-document-store";
import { issueToTaskCard } from "./task-mapping";
import {
  buildTaskIndex,
  normalizeTitleKey,
  resolveTaskFromIndex,
  type TaskIndex,
  TaskResolutionAmbiguousError,
  TaskResolutionNotFoundError,
} from "./task-resolution";
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
  canReplaceEpicSubtaskStatus,
  getSetPlanError,
  getSetSpecError,
  validatePlanSubtaskRules,
} from "./workflow-policy";

export type OdtTaskStoreDeps = {
  runProcess?: BdRuntimeClientDeps["runProcess"];
  resolveBeadsDir?: BdRuntimeClientDeps["resolveBeadsDir"];
  now?: TimeProvider;
};

export class OdtTaskStore {
  readonly repoPath: string;
  readonly metadataNamespace: string;
  private readonly persistence: BdPersistence;
  private readonly documentStore: TaskDocumentStore;
  private taskIndex: TaskIndex | null;
  private taskIndexBuildPromise: Promise<TaskIndex> | null;

  constructor(options: OdtStoreOptions, deps: OdtTaskStoreDeps = {}) {
    this.repoPath = options.repoPath;
    this.metadataNamespace = options.metadataNamespace;
    const bdClient = new BdRuntimeClient(this.repoPath, options.beadsDir ?? null, {
      ...(deps.runProcess ? { runProcess: deps.runProcess } : {}),
      ...(deps.resolveBeadsDir ? { resolveBeadsDir: deps.resolveBeadsDir } : {}),
    });
    this.persistence = new BdPersistence(bdClient, this.metadataNamespace);
    this.documentStore = new TaskDocumentStore(this.persistence, deps.now ?? nowIso);
    this.taskIndex = null;
    this.taskIndexBuildPromise = null;
  }

  private async refreshTaskIndex(): Promise<TaskIndex> {
    const tasks = await this.persistence.listTasks();
    const next = buildTaskIndex(tasks);
    this.taskIndex = next;
    return next;
  }

  /**
   * Get or build cached task index for O(1) lookups.
   * Rebuilds index when tasks change.
   */
  private async getOrBuildTaskIndex(): Promise<TaskIndex> {
    if (this.taskIndex) {
      return this.taskIndex;
    }

    if (this.taskIndexBuildPromise) {
      return this.taskIndexBuildPromise;
    }

    this.taskIndexBuildPromise = this.refreshTaskIndex();
    try {
      return await this.taskIndexBuildPromise;
    } finally {
      this.taskIndexBuildPromise = null;
    }
  }

  /** Invalidate task index after mutations */
  private invalidateTaskIndex(): void {
    this.taskIndex = null;
    this.taskIndexBuildPromise = null;
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
      invalidateTaskIndex: () => this.invalidateTaskIndex(),
      metadataNamespace: this.metadataNamespace,
    });
  }

  private async createSubtask(parentTaskId: string, subtask: PlanSubtaskInput): Promise<string> {
    return createSubtask(
      parentTaskId,
      subtask,
      (args) => this.persistence.runBdJson(args),
      () => this.invalidateTaskIndex(),
    );
  }

  private async deleteTask(taskId: string, deleteSubtasks = false): Promise<void> {
    await deleteTaskById(
      taskId,
      (args) => this.persistence.runBdJson(args),
      () => this.invalidateTaskIndex(),
      deleteSubtasks,
    );
  }

  private async prepareEpicSubtaskReplacement(
    task: TaskCard,
    normalizedSubtasks: PlanSubtaskInput[],
  ): Promise<{ latestTask: TaskCard; existingDirectSubtasks: TaskCard[] }> {
    const latestTasks = await this.persistence.listTasks();
    const latestTask = latestTasks.find((entry) => entry.id === task.id);
    if (!latestTask) {
      throw new Error(`Task not found: ${task.id}`);
    }

    assertNoValidationError(getSetPlanError(latestTask));
    validatePlanSubtaskRules(latestTask, latestTasks, normalizedSubtasks);

    const existingDirectSubtasks = latestTasks.filter((entry) => entry.parentId === task.id);
    const blockedSubtasks = existingDirectSubtasks.filter(
      (entry) => !canReplaceEpicSubtaskStatus(entry.status),
    );
    if (blockedSubtasks.length > 0) {
      const blockedSummary = blockedSubtasks
        .map((entry) => `${entry.id} (${entry.status})`)
        .join(", ");
      throw new Error(
        "Cannot replace epic subtasks while active work exists. " +
          `Move subtasks to open/spec_ready/ready_for_dev first: ${blockedSummary}`,
      );
    }

    return { latestTask, existingDirectSubtasks };
  }

  private async applyEpicSubtaskReplacement(
    task: TaskCard,
    existingDirectSubtasks: TaskCard[],
    normalizedSubtasks: PlanSubtaskInput[],
  ): Promise<string[]> {
    for (const existingSubtask of existingDirectSubtasks) {
      await this.deleteTask(existingSubtask.id);
    }

    const createdSubtaskIds: string[] = [];
    const createdTitleKeys = new Set<string>();
    for (const subtask of normalizedSubtasks) {
      const key = normalizeTitleKey(subtask.title);
      if (createdTitleKeys.has(key)) {
        continue;
      }

      const createdId = await this.createSubtask(task.id, subtask);
      createdSubtaskIds.push(createdId);
      createdTitleKeys.add(key);
    }

    return createdSubtaskIds;
  }

  async readTask(rawInput: unknown): Promise<unknown> {
    await this.persistence.ensureInitialized();
    const input = ReadTaskInputSchema.parse(rawInput);
    const index = await this.getOrBuildTaskIndex();

    let task: TaskCard;
    try {
      task = resolveTaskFromIndex(index, input.taskId);
    } catch (error) {
      const shouldRefreshIndex =
        error instanceof TaskResolutionNotFoundError ||
        error instanceof TaskResolutionAmbiguousError;
      if (!shouldRefreshIndex) {
        throw error;
      }

      const refreshedIndex = await this.refreshTaskIndex();
      task = resolveTaskFromIndex(refreshedIndex, input.taskId);
    }

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
      const epicReplacement = await this.prepareEpicSubtaskReplacement(task, normalizedSubtasks);
      persistedDocument = await this.documentStore.persistImplementationPlan(task.id, markdown);
      createdSubtaskIds = await this.applyEpicSubtaskReplacement(
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
