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

  constructor(options: OdtStoreOptions, deps: OdtTaskStoreDeps = {}) {
    this.repoPath = options.repoPath;
    this.metadataNamespace = options.metadataNamespace;
    this.beadsDir = options.beadsDir ?? null;
    this.runProcess = deps.runProcess ?? runProcess;
    this.resolveBeadsDir = deps.resolveBeadsDir ?? resolveCentralBeadsDir;
    this.now = deps.now ?? nowIso;
    this.initialized = false;
    this.initializationPromise = null;
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

  private formatTaskRef(task: TaskCard): string {
    return `${task.id} (${task.title})`;
  }

  private resolveTaskFromTasks(tasks: TaskCard[], requestedTaskId: string): TaskCard {
    const requestedLiteral = requestedTaskId.trim();
    if (requestedLiteral.length === 0) {
      throw new Error("Missing taskId.");
    }

    const requestedLower = normalizeTitleKey(requestedLiteral);
    const requestedSlug = toSearchSlug(requestedLiteral);

    const exact = tasks.find((entry) => entry.id === requestedLiteral);
    if (exact) {
      return exact;
    }

    const byCaseInsensitiveId = tasks.filter(
      (entry) => normalizeTitleKey(entry.id) === requestedLower,
    );
    const caseInsensitiveMatch = byCaseInsensitiveId.at(0);
    if (byCaseInsensitiveId.length === 1 && caseInsensitiveMatch) {
      return caseInsensitiveMatch;
    }
    if (byCaseInsensitiveId.length > 1) {
      const candidates = byCaseInsensitiveId.slice(0, 5).map((entry) => this.formatTaskRef(entry));
      throw new Error(
        `Task identifier "${requestedTaskId}" is ambiguous. Use exact task id. Candidates: ${candidates.join(", ")}`,
      );
    }

    if (requestedSlug.length > 0) {
      const byIdSuffix = tasks.filter((entry) => {
        const idLower = normalizeTitleKey(entry.id);
        return idLower === requestedSlug || idLower.endsWith(`-${requestedSlug}`);
      });
      const idSuffixMatch = byIdSuffix.at(0);
      if (byIdSuffix.length === 1 && idSuffixMatch) {
        return idSuffixMatch;
      }
      if (byIdSuffix.length > 1) {
        const candidates = byIdSuffix.slice(0, 5).map((entry) => this.formatTaskRef(entry));
        throw new Error(
          `Task identifier "${requestedTaskId}" is ambiguous. Use exact task id. Candidates: ${candidates.join(", ")}`,
        );
      }
    }

    const byTitleExact = tasks.filter((entry) => normalizeTitleKey(entry.title) === requestedLower);
    const titleExactMatch = byTitleExact.at(0);
    if (byTitleExact.length === 1 && titleExactMatch) {
      return titleExactMatch;
    }
    if (byTitleExact.length > 1) {
      const candidates = byTitleExact.slice(0, 5).map((entry) => this.formatTaskRef(entry));
      throw new Error(
        `Task identifier "${requestedTaskId}" is ambiguous. Use exact task id. Candidates: ${candidates.join(", ")}`,
      );
    }

    if (requestedSlug.length > 0) {
      const byTitleSlugExact = tasks.filter((entry) => toSearchSlug(entry.title) === requestedSlug);
      const titleSlugMatch = byTitleSlugExact.at(0);
      if (byTitleSlugExact.length === 1 && titleSlugMatch) {
        return titleSlugMatch;
      }
      if (byTitleSlugExact.length > 1) {
        const candidates = byTitleSlugExact.slice(0, 5).map((entry) => this.formatTaskRef(entry));
        throw new Error(
          `Task identifier "${requestedTaskId}" is ambiguous. Use exact task id. Candidates: ${candidates.join(", ")}`,
        );
      }
    }

    const byTitleContains = tasks.filter((entry) => {
      const titleLower = normalizeTitleKey(entry.title);
      const titleSlug = toSearchSlug(entry.title);
      return (
        (requestedLower.length > 0 && titleLower.includes(requestedLower)) ||
        (requestedSlug.length > 0 && titleSlug.includes(requestedSlug))
      );
    });
    const titleContainsMatch = byTitleContains.at(0);
    if (byTitleContains.length === 1 && titleContainsMatch) {
      return titleContainsMatch;
    }
    if (byTitleContains.length > 1) {
      const candidates = byTitleContains.slice(0, 5).map((entry) => this.formatTaskRef(entry));
      throw new Error(
        `Task identifier "${requestedTaskId}" is ambiguous. Use exact task id. Candidates: ${candidates.join(", ")}`,
      );
    }

    const hints = tasks
      .filter((entry) => {
        const idLower = normalizeTitleKey(entry.id);
        const titleLower = normalizeTitleKey(entry.title);
        const titleSlug = toSearchSlug(entry.title);
        return (
          (requestedLower.length > 0 &&
            (idLower.includes(requestedLower) || titleLower.includes(requestedLower))) ||
          (requestedSlug.length > 0 &&
            (idLower.includes(requestedSlug) || titleSlug.includes(requestedSlug)))
        );
      })
      .slice(0, 5);
    const fallback = (hints.length > 0 ? hints : tasks.slice(0, 5)).map((entry) =>
      this.formatTaskRef(entry),
    );
    const hintSuffix = fallback.length > 0 ? ` Candidate task ids: ${fallback.join(", ")}` : "";
    throw new Error(`Task not found: ${requestedTaskId}.${hintSuffix}`);
  }

  private async resolveTaskContext(taskId: string): Promise<TaskContext> {
    const tasks = await this.listTasks();
    const task = this.resolveTaskFromTasks(tasks, taskId);
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

    return id;
  }

  async readTask(rawInput: unknown): Promise<unknown> {
    await this.ensureInitialized();
    const input = ReadTaskInputSchema.parse(rawInput);
    const tasks = await this.listTasks();
    const task = this.resolveTaskFromTasks(tasks, input.taskId);
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

    const { task } = await this.resolveTaskContext(input.taskId);
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
      nextTask = await this.transitionTask(task.id, "spec_ready");
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

    const { task, tasks } = await this.resolveTaskContext(input.taskId);
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
    let transitionContext: TaskContext | undefined;
    if (task.issueType === "epic" && normalizedSubtasks.length > 0) {
      const existingTaskSnapshot = await this.resolveTaskContext(task.id);
      transitionContext = existingTaskSnapshot;
      const existingTitleKeys = new Set(
        existingTaskSnapshot.tasks
          .filter((entry) => entry.parentId === task.id)
          .map((entry) => normalizeTitleKey(entry.title)),
      );

      for (const subtask of normalizedSubtasks) {
        const key = normalizeTitleKey(subtask.title);
        if (existingTitleKeys.has(key)) {
          continue;
        }

        const createdId = await this.createSubtask(task.id, subtask);
        createdSubtaskIds.push(createdId);
        existingTitleKeys.add(key);
      }

      if (createdSubtaskIds.length > 0) {
        transitionContext = undefined;
      }
    }

    const nextTask = await this.transitionTask(task.id, "ready_for_dev", transitionContext);

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
    const { task } = context;

    const nextStatus: TaskStatus = task.aiReviewEnabled ? "ai_review" : "human_review";
    const updated = await this.transitionTask(task.id, nextStatus, context);
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
    const { task, tasks } = await this.resolveTaskContext(input.taskId);
    this.assertTransitionAllowed(task, tasks, "human_review");
    await this.appendQaReport(task.id, input.reportMarkdown.trim(), "approved");
    const updated = await this.transitionTask(task.id, "human_review");
    return { task: updated };
  }

  async qaRejected(rawInput: unknown): Promise<unknown> {
    await this.ensureInitialized();
    const input = QaRejectedInputSchema.parse(rawInput);
    const { task, tasks } = await this.resolveTaskContext(input.taskId);
    this.assertTransitionAllowed(task, tasks, "in_progress");
    await this.appendQaReport(task.id, input.reportMarkdown.trim(), "rejected");
    const updated = await this.transitionTask(task.id, "in_progress");
    return { task: updated };
  }
}
