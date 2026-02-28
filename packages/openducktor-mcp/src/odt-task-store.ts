import { BdRuntimeClient, type BdRuntimeClientDeps } from "./bd-runtime-client";
import { nowIso, type TimeProvider } from "./beads-runtime";
import type {
  JsonObject,
  MarkdownEntry,
  PlanSubtaskInput,
  QaEntry,
  RawIssue,
  TaskCard,
  TaskStatus,
} from "./contracts";
import { createSubtask, deleteTaskById } from "./epic-subtasks";
import { getNamespaceData, parseTaskDocuments } from "./metadata-docs";
import { normalizePlanSubtasks } from "./plan-subtasks";
import type { OdtStoreOptions } from "./store-context";
import { issueToTaskCard, parseMarkdownEntries, parseQaEntries } from "./task-mapping";
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
  private readonly bdClient: BdRuntimeClient;
  private readonly now: TimeProvider;
  private taskIndex: TaskIndex | null;
  private taskIndexBuildPromise: Promise<TaskIndex> | null;

  constructor(options: OdtStoreOptions, deps: OdtTaskStoreDeps = {}) {
    this.repoPath = options.repoPath;
    this.metadataNamespace = options.metadataNamespace;
    this.bdClient = new BdRuntimeClient(this.repoPath, options.beadsDir ?? null, {
      ...(deps.runProcess ? { runProcess: deps.runProcess } : {}),
      ...(deps.resolveBeadsDir ? { resolveBeadsDir: deps.resolveBeadsDir } : {}),
    });
    this.now = deps.now ?? nowIso;
    this.taskIndex = null;
    this.taskIndexBuildPromise = null;
  }

  private async runBdJson(args: string[]): Promise<unknown> {
    return this.bdClient.runBdJson(args);
  }

  private async ensureInitialized(): Promise<void> {
    await this.bdClient.ensureInitialized();
  }

  private async showRawIssue(taskId: string): Promise<RawIssue> {
    const payload = await this.runBdJson(["show", taskId]);
    if (!Array.isArray(payload) || payload.length === 0) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const issue = payload[0];
    if (!issue || typeof issue !== "object") {
      throw new Error(`Invalid issue payload for task ${taskId}`);
    }

    return issue as RawIssue;
  }

  private async listTasks(): Promise<TaskCard[]> {
    const payload = await this.runBdJson(["list", "--all", "-n", "500"]);
    if (!Array.isArray(payload)) {
      throw new Error("bd list did not return an array");
    }

    return payload
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => issueToTaskCard(entry as RawIssue, this.metadataNamespace));
  }

  private async refreshTaskIndex(): Promise<TaskIndex> {
    const tasks = await this.listTasks();
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
    return resolveTaskContext(taskId, () => this.listTasks());
  }

  private async refreshTaskContext(taskId: string, context?: TaskContext): Promise<TaskContext> {
    return refreshTaskContext({
      taskId,
      ...(context ? { context } : {}),
      showRawIssue: (id) => this.showRawIssue(id),
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
      listTasks: () => this.listTasks(),
      runBdJson: (args) => this.runBdJson(args),
      showRawIssue: (id) => this.showRawIssue(id),
      invalidateTaskIndex: () => this.invalidateTaskIndex(),
      metadataNamespace: this.metadataNamespace,
    });
  }

  private getNamespaceData(issue: RawIssue): {
    root: JsonObject;
    namespace: JsonObject;
    documents: JsonObject;
  } {
    return getNamespaceData(issue, this.metadataNamespace);
  }

  private async writeNamespace(
    taskId: string,
    root: JsonObject,
    namespace: JsonObject,
  ): Promise<void> {
    const nextRoot = {
      ...root,
      [this.metadataNamespace]: namespace,
    };

    await this.runBdJson(["update", taskId, "--metadata", JSON.stringify(nextRoot)]);
  }

  private parseDocs(issue: RawIssue): {
    spec: { markdown: string; updatedAt: string | null };
    implementationPlan: { markdown: string; updatedAt: string | null };
    latestQaReport: {
      markdown: string;
      updatedAt: string | null;
      verdict: "approved" | "rejected" | null;
    };
  } {
    return parseTaskDocuments(issue, this.metadataNamespace);
  }

  private async createSubtask(parentTaskId: string, subtask: PlanSubtaskInput): Promise<string> {
    return createSubtask(
      parentTaskId,
      subtask,
      (args) => this.runBdJson(args),
      () => this.invalidateTaskIndex(),
    );
  }

  private async deleteTask(taskId: string, deleteSubtasks = false): Promise<void> {
    await deleteTaskById(
      taskId,
      (args) => this.runBdJson(args),
      () => this.invalidateTaskIndex(),
      deleteSubtasks,
    );
  }

  private async applyEpicSubtaskReplacement(
    task: TaskCard,
    normalizedSubtasks: PlanSubtaskInput[],
    persistPlanDocument: () => Promise<{ updatedAt: string; revision: number }>,
  ): Promise<{ createdSubtaskIds: string[]; document: { updatedAt: string; revision: number } }> {
    const latestTasks = await this.listTasks();
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

    const document = await persistPlanDocument();

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

    return { createdSubtaskIds, document };
  }

  async readTask(rawInput: unknown): Promise<unknown> {
    await this.ensureInitialized();
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

    const issue = await this.showRawIssue(task.id);
    const taskCard = issueToTaskCard(issue, this.metadataNamespace);
    const docs = this.parseDocs(issue);

    return {
      task: taskCard,
      documents: docs,
    };
  }

  async setSpec(rawInput: unknown): Promise<unknown> {
    await this.ensureInitialized();
    const input = SetSpecInputSchema.parse(rawInput);
    const markdown = input.markdown.trim();

    const context = await this.resolveTaskContext(input.taskId);
    const { task } = context;
    assertNoValidationError(getSetSpecError(task.status));

    const issue = await this.showRawIssue(task.id);
    const { root, namespace, documents } = this.getNamespaceData(issue);
    const nextRevision = (parseMarkdownEntries(documents.spec).at(-1)?.revision ?? 0) + 1;

    const updatedAt = this.now();
    const entry: MarkdownEntry = {
      markdown,
      updatedAt,
      updatedBy: "spec-agent",
      sourceTool: "odt_set_spec",
      revision: nextRevision,
    };

    const nextDocuments = {
      ...documents,
      spec: [entry],
    };

    const nextNamespace = {
      ...namespace,
      documents: nextDocuments,
    };

    await this.writeNamespace(task.id, root, nextNamespace);

    let nextTask: TaskCard = task;
    if (task.status === "open") {
      const refreshedContext = await this.refreshTaskContext(task.id, context);
      nextTask = await this.transitionTask(task.id, "spec_ready", refreshedContext);
    }

    return {
      task: nextTask,
      document: {
        markdown,
        updatedAt,
        revision: nextRevision,
      },
    };
  }

  async setPlan(rawInput: unknown): Promise<unknown> {
    await this.ensureInitialized();
    const input = SetPlanInputSchema.parse(rawInput);
    const markdown = input.markdown.trim();

    const context = await this.resolveTaskContext(input.taskId);
    const { task, tasks } = context;
    assertNoValidationError(getSetPlanError(task));

    const normalizedSubtasks = normalizePlanSubtasks(input.subtasks ?? []);
    const persistPlanDocument = async (): Promise<{ updatedAt: string; revision: number }> => {
      const issue = await this.showRawIssue(task.id);
      const { root, namespace, documents } = this.getNamespaceData(issue);
      const nextRevision =
        (parseMarkdownEntries(documents.implementationPlan).at(-1)?.revision ?? 0) + 1;

      const updatedAt = this.now();
      const entry: MarkdownEntry = {
        markdown,
        updatedAt,
        updatedBy: "planner-agent",
        sourceTool: "odt_set_plan",
        revision: nextRevision,
      };

      const nextDocuments = {
        ...documents,
        implementationPlan: [entry],
      };

      const nextNamespace = {
        ...namespace,
        documents: nextDocuments,
      };

      await this.writeNamespace(task.id, root, nextNamespace);
      return {
        updatedAt,
        revision: nextRevision,
      };
    };

    let persistedDocument: { updatedAt: string; revision: number };
    let createdSubtaskIds: string[] = [];
    if (task.issueType === "epic") {
      const epicReplacement = await this.applyEpicSubtaskReplacement(
        task,
        normalizedSubtasks,
        persistPlanDocument,
      );
      createdSubtaskIds = epicReplacement.createdSubtaskIds;
      persistedDocument = epicReplacement.document;
    } else {
      validatePlanSubtaskRules(task, tasks, normalizedSubtasks);
      persistedDocument = await persistPlanDocument();
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
    await this.ensureInitialized();
    const input = BuildBlockedInputSchema.parse(rawInput);
    const task = await this.transitionTask(input.taskId, "blocked");
    return {
      task,
      reason: input.reason,
    };
  }

  async buildResumed(rawInput: unknown): Promise<unknown> {
    await this.ensureInitialized();
    const input = BuildResumedInputSchema.parse(rawInput);
    const task = await this.transitionTask(input.taskId, "in_progress");
    return { task };
  }

  async buildCompleted(rawInput: unknown): Promise<unknown> {
    await this.ensureInitialized();
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

  private async appendQaReport(
    taskId: string,
    markdown: string,
    verdict: "approved" | "rejected",
  ): Promise<void> {
    const issue = await this.showRawIssue(taskId);
    const { root, namespace, documents } = this.getNamespaceData(issue);
    const entries = parseQaEntries(documents.qaReports);
    const nextRevision = (entries.at(-1)?.revision ?? 0) + 1;

    const entry: QaEntry = {
      markdown,
      verdict,
      updatedAt: this.now(),
      updatedBy: "qa-agent",
      sourceTool: verdict === "approved" ? "odt_qa_approved" : "odt_qa_rejected",
      revision: nextRevision,
    };

    const nextDocuments = {
      ...documents,
      qaReports: [...entries, entry],
    };

    const nextNamespace = {
      ...namespace,
      documents: nextDocuments,
    };

    await this.writeNamespace(taskId, root, nextNamespace);
  }

  async qaApproved(rawInput: unknown): Promise<unknown> {
    await this.ensureInitialized();
    const input = QaApprovedInputSchema.parse(rawInput);
    const context = await this.resolveTaskContext(input.taskId);
    const { task, tasks } = context;
    this.assertTransitionAllowed(task, tasks, "human_review");
    await this.appendQaReport(task.id, input.reportMarkdown.trim(), "approved");
    const refreshedContext = await this.refreshTaskContext(task.id, context);
    const updated = await this.transitionTask(task.id, "human_review", refreshedContext);
    return { task: updated };
  }

  async qaRejected(rawInput: unknown): Promise<unknown> {
    await this.ensureInitialized();
    const input = QaRejectedInputSchema.parse(rawInput);
    const context = await this.resolveTaskContext(input.taskId);
    const { task, tasks } = context;
    this.assertTransitionAllowed(task, tasks, "in_progress");
    await this.appendQaReport(task.id, input.reportMarkdown.trim(), "rejected");
    const refreshedContext = await this.refreshTaskContext(task.id, context);
    const updated = await this.transitionTask(task.id, "in_progress", refreshedContext);
    return { task: updated };
  }
}
