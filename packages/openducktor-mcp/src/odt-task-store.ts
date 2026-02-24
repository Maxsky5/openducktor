/**
 * Indexed lookup maps for O(1) task resolution.
 * Built once per tasks load, enables single-pass matching.
 */
interface TaskIndex {
  /** All tasks array (for fallback hints) */
  tasks: TaskCard[];
  entries: TaskIndexEntry[];
  /** Exact ID lookup (case-sensitive) */
  idExact: Map<string, TaskCard>;
  /** Case-insensitive ID lookup */
  idLower: Map<string, TaskCard[]>;
  idSuffix: Map<string, TaskCard[]>;
  /** Exact title lookup (lowercase) */
  titleExact: Map<string, TaskCard[]>;
  /** Title slug lookup (sanitized) */
  titleSlug: Map<string, TaskCard[]>;
}

interface TaskIndexEntry {
  task: TaskCard;
  idLower: string;
  titleLower: string;
  titleSlug: string;
}

const MAX_TASK_CANDIDATES = 5;

const formatTaskRef = (task: TaskCard): string => `${task.id} (${task.title})`;

class TaskResolutionAmbiguousError extends Error {
  readonly requestedTaskId: string;
  readonly candidates: string[];

  constructor(requestedTaskId: string, candidates: string[]) {
    super(
      `Task identifier "${requestedTaskId}" is ambiguous. Use exact task id. Candidates: ${candidates.join(", ")}`,
    );
    this.name = "TaskResolutionAmbiguousError";
    this.requestedTaskId = requestedTaskId;
    this.candidates = candidates;
  }
}

class TaskResolutionNotFoundError extends Error {
  readonly requestedTaskId: string;
  readonly candidates: string[];

  constructor(requestedTaskId: string, candidates: string[]) {
    const hintSuffix = candidates.length > 0 ? ` Candidate task ids: ${candidates.join(", ")}` : "";
    super(`Task not found: ${requestedTaskId}.${hintSuffix}`);
    this.name = "TaskResolutionNotFoundError";
    this.requestedTaskId = requestedTaskId;
    this.candidates = candidates;
  }
}

function throwAmbiguousTaskIdentifier(requestedTaskId: string, matches: TaskCard[]): never {
  const candidates = matches.slice(0, MAX_TASK_CANDIDATES).map(formatTaskRef);
  throw new TaskResolutionAmbiguousError(requestedTaskId, candidates);
}

/**
 * Build normalized lookup maps from tasks array.
 * O(n) build time, enables O(1) lookups.
 */
function buildTaskIndex(tasks: TaskCard[]): TaskIndex {
  const idExact = new Map<string, TaskCard>();
  const idLower = new Map<string, TaskCard[]>();
  const idSuffix = new Map<string, TaskCard[]>();
  const titleExact = new Map<string, TaskCard[]>();
  const titleSlug = new Map<string, TaskCard[]>();
  const entries: TaskIndexEntry[] = [];

  const addTaskToBucket = (map: Map<string, TaskCard[]>, key: string, task: TaskCard): void => {
    const existing = map.get(key);
    if (existing) {
      existing.push(task);
    } else {
      map.set(key, [task]);
    }
  };

  for (const task of tasks) {
    const normalizedId = normalizeTitleKey(task.id);
    const normalizedTitle = normalizeTitleKey(task.title);
    const normalizedTitleSlug = toSearchSlug(task.title);

    // Exact ID (case-sensitive)
    idExact.set(task.id, task);

    // Case-insensitive ID
    addTaskToBucket(idLower, normalizedId, task);

    addTaskToBucket(idSuffix, normalizedId, task);
    for (let i = 0; i < normalizedId.length; i += 1) {
      if (normalizedId[i] !== "-") {
        continue;
      }
      const suffix = normalizedId.slice(i + 1);
      if (suffix.length > 0) {
        addTaskToBucket(idSuffix, suffix, task);
      }
    }

    // Exact title (lowercase)
    addTaskToBucket(titleExact, normalizedTitle, task);

    // Title slug
    if (normalizedTitleSlug.length > 0) {
      addTaskToBucket(titleSlug, normalizedTitleSlug, task);
    }

    entries.push({
      task,
      idLower: normalizedId,
      titleLower: normalizedTitle,
      titleSlug: normalizedTitleSlug,
    });
  }

  return {
    tasks,
    entries,
    idExact,
    idLower,
    idSuffix,
    titleExact,
    titleSlug,
  };
}

/**
 * Resolve task using indexed lookup.
 * Single-pass for contains/hints, O(1) for exact matches.
 */
function resolveTaskFromIndex(index: TaskIndex, requestedTaskId: string): TaskCard {
  const requestedLiteral = requestedTaskId.trim();
  if (requestedLiteral.length === 0) {
    throw new Error("Missing taskId.");
  }

  const requestedLower = normalizeTitleKey(requestedLiteral);
  const requestedSlug = toSearchSlug(requestedLiteral);

  // 1. Exact ID (case-sensitive) - O(1)
  const exact = index.idExact.get(requestedLiteral);
  if (exact) {
    return exact;
  }

  // 2. Case-insensitive ID - O(1)
  const byCaseInsensitiveId = index.idLower.get(requestedLower);
  if (byCaseInsensitiveId) {
    if (byCaseInsensitiveId.length === 1 && byCaseInsensitiveId[0]) {
      return byCaseInsensitiveId[0];
    }
    if (byCaseInsensitiveId.length > 1) {
      throwAmbiguousTaskIdentifier(requestedTaskId, byCaseInsensitiveId);
    }
  }

  // 3. ID slug suffix match - scan for IDs ending with requestedSlug
  if (requestedSlug.length > 0) {
    const byIdSuffix = index.idSuffix.get(requestedSlug);

    if (byIdSuffix?.length === 1 && byIdSuffix[0]) {
      return byIdSuffix[0];
    }
    if (byIdSuffix && byIdSuffix.length > 1) {
      throwAmbiguousTaskIdentifier(requestedTaskId, byIdSuffix);
    }
  }

  // 4. Exact title (lowercase) - O(1)
  const byTitleExact = index.titleExact.get(requestedLower);
  if (byTitleExact) {
    if (byTitleExact.length === 1 && byTitleExact[0]) {
      return byTitleExact[0];
    }
    if (byTitleExact.length > 1) {
      throwAmbiguousTaskIdentifier(requestedTaskId, byTitleExact);
    }
  }

  // 5. Title slug exact match - O(1)
  if (requestedSlug.length > 0) {
    const byTitleSlugExact = index.titleSlug.get(requestedSlug);
    if (byTitleSlugExact) {
      if (byTitleSlugExact.length === 1 && byTitleSlugExact[0]) {
        return byTitleSlugExact[0];
      }
      if (byTitleSlugExact.length > 1) {
        throwAmbiguousTaskIdentifier(requestedTaskId, byTitleSlugExact);
      }
    }
  }

  // 6. Contains search (title contains) - single pass O(n)
  const byTitleContains: TaskCard[] = [];
  if (requestedLower.length > 0 || requestedSlug.length > 0) {
    for (const entry of index.entries) {
      const matchesLower = requestedLower.length > 0 && entry.titleLower.includes(requestedLower);
      const matchesSlug = requestedSlug.length > 0 && entry.titleSlug.includes(requestedSlug);

      if (matchesLower || matchesSlug) {
        byTitleContains.push(entry.task);
        if (byTitleContains.length > MAX_TASK_CANDIDATES) {
          break; // Only need 6+ to detect ambiguity
        }
      }
    }
  }

  if (byTitleContains.length === 1 && byTitleContains[0]) {
    return byTitleContains[0];
  }
  if (byTitleContains.length > 1) {
    throwAmbiguousTaskIdentifier(requestedTaskId, byTitleContains);
  }

  // 7. Fallback hints (partial ID/title match) - single pass O(n)
  const hints: TaskCard[] = [];
  if (requestedLower.length > 0 || requestedSlug.length > 0) {
    for (const entry of index.entries) {
      const matchesIdLower = requestedLower.length > 0 && entry.idLower.includes(requestedLower);
      const matchesTitleLower =
        requestedLower.length > 0 && entry.titleLower.includes(requestedLower);
      const matchesIdSlug = requestedSlug.length > 0 && entry.idLower.includes(requestedSlug);
      const matchesTitleSlug = requestedSlug.length > 0 && entry.titleSlug.includes(requestedSlug);

      if (matchesIdLower || matchesTitleLower || matchesIdSlug || matchesTitleSlug) {
        hints.push(entry.task);
        if (hints.length >= MAX_TASK_CANDIDATES) {
          break;
        }
      }
    }
  }

  const fallback = (hints.length > 0 ? hints : index.tasks.slice(0, MAX_TASK_CANDIDATES)).map(
    formatTaskRef,
  );
  throw new TaskResolutionNotFoundError(requestedTaskId, fallback);
}

import { basename } from "node:path";
import {
  type BeadsDirResolver,
  CUSTOM_STATUS_VALUES,
  nowIso,
  type ProcessRunner,
  resolveCentralBeadsDir,
  runProcess,
  sanitizeSlug,
  type TimeProvider,
} from "./beads-runtime";
import type {
  JsonObject,
  MarkdownEntry,
  PlanSubtaskInput,
  QaEntry,
  RawIssue,
  TaskCard,
  TaskStatus,
} from "./contracts";
import { normalizePlanSubtasks } from "./plan-subtasks";
import type { OdtStoreOptions } from "./store-context";
import {
  ensureObject,
  issueToTaskCard,
  parseMarkdownEntries,
  parseMetadataRoot,
  parseQaEntries,
} from "./task-mapping";
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
  validateTransition,
} from "./workflow-policy";

export type OdtTaskStoreDeps = {
  runProcess?: ProcessRunner;
  resolveBeadsDir?: BeadsDirResolver;
  now?: TimeProvider;
};

const normalizeTitleKey = (value: string): string => value.trim().toLowerCase();

const toSearchSlug = (value: string): string => {
  if (!/[a-z0-9]/i.test(value)) {
    return "";
  }
  return sanitizeSlug(value);
};

type TaskContext = {
  task: TaskCard;
  tasks: TaskCard[];
};

export class OdtTaskStore {
  readonly repoPath: string;
  readonly metadataNamespace: string;
  private beadsDir: string | null;
  private readonly runProcess: ProcessRunner;
  private readonly resolveBeadsDir: BeadsDirResolver;
  private readonly now: TimeProvider;
  private initialized: boolean;
  private initializationPromise: Promise<void> | null;
  private taskIndex: TaskIndex | null;
  private taskIndexBuildPromise: Promise<TaskIndex> | null;

  constructor(options: OdtStoreOptions, deps: OdtTaskStoreDeps = {}) {
    this.repoPath = options.repoPath;
    this.metadataNamespace = options.metadataNamespace;
    this.beadsDir = options.beadsDir ?? null;
    this.runProcess = deps.runProcess ?? runProcess;
    this.resolveBeadsDir = deps.resolveBeadsDir ?? resolveCentralBeadsDir;
    this.now = deps.now ?? nowIso;
    this.initialized = false;
    this.initializationPromise = null;
    this.taskIndex = null;
    this.taskIndexBuildPromise = null;
  }

  private async ensureBeadsDir(): Promise<string> {
    if (this.beadsDir) {
      return this.beadsDir;
    }

    this.beadsDir = await this.resolveBeadsDir(this.repoPath);
    return this.beadsDir;
  }

  private async runBd(
    args: string[],
    options?: { json?: boolean; allowFailure?: boolean },
  ): Promise<string> {
    const beadsDir = await this.ensureBeadsDir();
    const finalArgs = ["--no-daemon", ...args];
    if (options?.json) {
      finalArgs.push("--json");
    }

    const result = await this.runProcess("bd", finalArgs, this.repoPath, {
      BEADS_DIR: beadsDir,
    });

    if (!result.ok && !options?.allowFailure) {
      const details = result.stderr || result.stdout || "bd command failed";
      throw new Error(`bd ${finalArgs.join(" ")} failed: ${details}`);
    }

    return result.stdout;
  }

  private async runBdJson(args: string[]): Promise<unknown> {
    const output = await this.runBd(args, { json: true });
    try {
      return JSON.parse(output);
    } catch {
      throw new Error(`Failed to parse bd JSON output for args: ${args.join(" ")}`);
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializationPromise) {
      await this.initializationPromise;
      return;
    }

    this.initializationPromise = (async () => {
      const whereOutput = await this.runBd(["where"], { json: true, allowFailure: true });
      let ready = false;

      try {
        const parsed = JSON.parse(whereOutput) as { path?: unknown };
        ready = typeof parsed.path === "string" && parsed.path.trim().length > 0;
      } catch {
        ready = false;
      }

      if (!ready) {
        const slug = sanitizeSlug(basename(this.repoPath));
        await this.runBd([
          "init",
          "--quiet",
          "--skip-hooks",
          "--skip-merge-driver",
          "--prefix",
          slug,
        ]);
      }

      await this.runBd(["config", "set", "status.custom", CUSTOM_STATUS_VALUES]);
      this.initialized = true;
    })();

    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
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
    const tasks = await this.listTasks();
    const task = resolveTaskFromIndex(buildTaskIndex(tasks), taskId);
    return { task, tasks };
  }

  private async refreshTaskContext(taskId: string, context?: TaskContext): Promise<TaskContext> {
    const issue = await this.showRawIssue(taskId);
    const task = issueToTaskCard(issue, this.metadataNamespace);

    if (!context) {
      return {
        task,
        tasks: [task],
      };
    }

    const hasTask = context.tasks.some((entry) => entry.id === task.id);
    const tasks = hasTask
      ? context.tasks.map((entry) => (entry.id === task.id ? task : entry))
      : [...context.tasks, task];

    return { task, tasks };
  }

  private assertTransitionAllowed(task: TaskCard, tasks: TaskCard[], nextStatus: TaskStatus): void {
    validateTransition(task, tasks, task.status, nextStatus);
  }

  private async applyTransition(task: TaskCard, nextStatus: TaskStatus): Promise<TaskCard> {
    if (task.status !== nextStatus) {
      await this.runBdJson(["update", task.id, "--status", nextStatus]);
    }

    const refreshed = await this.showRawIssue(task.id);
    this.invalidateTaskIndex();
    return issueToTaskCard(refreshed, this.metadataNamespace);
  }

  private async transitionTask(
    taskId: string,
    next: TaskStatus,
    context?: TaskContext,
  ): Promise<TaskCard> {
    const { task, tasks } = context ?? (await this.resolveTaskContext(taskId));
    this.assertTransitionAllowed(task, tasks, next);
    return this.applyTransition(task, next);
  }

  private getNamespaceData(issue: RawIssue): {
    root: JsonObject;
    namespace: JsonObject;
    documents: JsonObject;
  } {
    const root = parseMetadataRoot(issue.metadata);
    const namespace = ensureObject(root[this.metadataNamespace]);
    const documents = ensureObject(namespace.documents);
    return {
      root,
      namespace,
      documents,
    };
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
    const { documents } = this.getNamespaceData(issue);
    const specEntries = parseMarkdownEntries(documents.spec);
    const planEntries = parseMarkdownEntries(documents.implementationPlan);
    const qaEntries = parseQaEntries(documents.qaReports);

    const specLatest = specEntries.at(-1);
    const planLatest = planEntries.at(-1);
    const qaLatest = qaEntries.at(-1);

    return {
      spec: {
        markdown: specLatest?.markdown ?? "",
        updatedAt: specLatest?.updatedAt ?? null,
      },
      implementationPlan: {
        markdown: planLatest?.markdown ?? "",
        updatedAt: planLatest?.updatedAt ?? null,
      },
      latestQaReport: {
        markdown: qaLatest?.markdown ?? "",
        updatedAt: qaLatest?.updatedAt ?? null,
        verdict: qaLatest?.verdict ?? null,
      },
    };
  }

  private async createSubtask(parentTaskId: string, subtask: PlanSubtaskInput): Promise<string> {
    const args = [
      "create",
      subtask.title,
      "--type",
      subtask.issueType ?? "task",
      "--priority",
      String(subtask.priority ?? 2),
      "--parent",
      parentTaskId,
    ];

    if (subtask.description && subtask.description.trim().length > 0) {
      args.push("--description", subtask.description.trim());
    }

    const payload = await this.runBdJson(args);
    if (!payload || typeof payload !== "object") {
      throw new Error("Failed to create subtask");
    }

    const id = (payload as { id?: unknown }).id;
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new Error("Failed to resolve created subtask id");
    }

    this.invalidateTaskIndex();
    return id;
  }

  private async deleteTask(taskId: string, deleteSubtasks = false): Promise<void> {
    const args = ["delete", "--force", "--reason", "Deleted from OpenDucktor"];
    if (deleteSubtasks) {
      args.push("--cascade");
    }
    args.push("--", taskId);
    await this.runBdJson(args);
    this.invalidateTaskIndex();
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
    validatePlanSubtaskRules(task, tasks, normalizedSubtasks);

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

    const createdSubtaskIds: string[] = [];
    if (task.issueType === "epic" && normalizedSubtasks.length > 0) {
      const existingDirectSubtasks = tasks.filter((entry) => entry.parentId === task.id);
      for (const existingSubtask of existingDirectSubtasks) {
        await this.deleteTask(existingSubtask.id);
      }

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
        updatedAt,
        revision: nextRevision,
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
