import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { z } from "zod";

const CUSTOM_STATUS_VALUES = "spec_ready,ready_for_dev,ai_review,human_review";

export type TaskStatus =
  | "open"
  | "spec_ready"
  | "ready_for_dev"
  | "in_progress"
  | "blocked"
  | "ai_review"
  | "human_review"
  | "deferred"
  | "closed";

export type IssueType = "epic" | "feature" | "task" | "bug";

export type PlanSubtaskInput = {
  title: string;
  issueType?: "task" | "feature" | "bug" | undefined;
  priority?: number | undefined;
  description?: string | undefined;
};

export type TaskCard = {
  id: string;
  title: string;
  status: TaskStatus;
  issueType: IssueType;
  aiReviewEnabled: boolean;
  parentId: string | null;
};

type RawIssue = {
  id: string;
  title: string;
  status: string;
  issue_type?: string;
  parent?: string | null;
  dependencies?: Array<{
    type?: string;
    dependency_type?: string;
    depends_on_id?: string | null;
    id?: string | null;
  }>;
  metadata?: unknown;
};

type MarkdownEntry = {
  markdown: string;
  updatedAt: string;
  updatedBy: string;
  sourceTool: string;
  revision: number;
};

type QaEntry = {
  markdown: string;
  verdict: "approved" | "rejected";
  updatedAt: string;
  updatedBy: string;
  sourceTool: string;
  revision: number;
};

type JsonObject = Record<string, unknown>;

const ReadTaskInputSchema = z.object({
  taskId: z.string().trim().min(1),
});

const SetSpecInputSchema = z.object({
  taskId: z.string().trim().min(1),
  markdown: z.string().trim().min(1),
});

const SetPlanInputSchema = z.object({
  taskId: z.string().trim().min(1),
  markdown: z.string().trim().min(1),
  subtasks: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        issueType: z.enum(["task", "feature", "bug"]).optional(),
        priority: z.number().int().min(0).max(4).optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
});

const BuildBlockedInputSchema = z.object({
  taskId: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});

const BuildResumedInputSchema = z.object({
  taskId: z.string().trim().min(1),
});

const BuildCompletedInputSchema = z.object({
  taskId: z.string().trim().min(1),
  summary: z.string().optional(),
});

const QaApprovedInputSchema = z.object({
  taskId: z.string().trim().min(1),
  reportMarkdown: z.string().trim().min(1),
});

const QaRejectedInputSchema = z.object({
  taskId: z.string().trim().min(1),
  reportMarkdown: z.string().trim().min(1),
});

export type ReadTaskInput = z.infer<typeof ReadTaskInputSchema>;
export type SetSpecInput = z.infer<typeof SetSpecInputSchema>;
export type SetPlanInput = z.infer<typeof SetPlanInputSchema>;
export type BuildBlockedInput = z.infer<typeof BuildBlockedInputSchema>;
export type BuildResumedInput = z.infer<typeof BuildResumedInputSchema>;
export type BuildCompletedInput = z.infer<typeof BuildCompletedInputSchema>;
export type QaApprovedInput = z.infer<typeof QaApprovedInputSchema>;
export type QaRejectedInput = z.infer<typeof QaRejectedInputSchema>;

export const ODT_TOOL_SCHEMAS = {
  odt_read_task: ReadTaskInputSchema,
  odt_set_spec: SetSpecInputSchema,
  odt_set_plan: SetPlanInputSchema,
  odt_build_blocked: BuildBlockedInputSchema,
  odt_build_resumed: BuildResumedInputSchema,
  odt_build_completed: BuildCompletedInputSchema,
  odt_qa_approved: QaApprovedInputSchema,
  odt_qa_rejected: QaRejectedInputSchema,
} as const;

const nowIso = (): string => new Date().toISOString();

const sanitizeSlug = (input: string): string => {
  let slug = "";
  let lastDash = false;

  for (const char of input) {
    const lower = char.toLowerCase();
    if (/^[a-z0-9]$/.test(lower)) {
      slug += lower;
      lastDash = false;
      continue;
    }
    if (!lastDash) {
      slug += "-";
      lastDash = true;
    }
  }

  slug = slug.replace(/^-+/, "").replace(/-+$/, "");
  return slug.length > 0 ? slug : "repo";
};

const normalizeIssueType = (value: unknown): IssueType => {
  if (value === "epic" || value === "feature" || value === "bug") {
    return value;
  }
  return "task";
};

const defaultQaRequiredForIssueType = (_issueType: IssueType): boolean => true;

const parseMetadataRoot = (metadata: unknown): JsonObject => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return { ...(metadata as JsonObject) };
};

const ensureObject = (value: unknown): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as JsonObject) };
};

const parseMarkdownEntries = (value: unknown): MarkdownEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: MarkdownEntry[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.markdown !== "string" ||
      typeof record.updatedAt !== "string" ||
      typeof record.updatedBy !== "string" ||
      typeof record.sourceTool !== "string" ||
      typeof record.revision !== "number"
    ) {
      continue;
    }
    entries.push({
      markdown: record.markdown,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy,
      sourceTool: record.sourceTool,
      revision: record.revision,
    });
  }
  return entries;
};

const parseQaEntries = (value: unknown): QaEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: QaEntry[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.markdown !== "string" ||
      (record.verdict !== "approved" && record.verdict !== "rejected") ||
      typeof record.updatedAt !== "string" ||
      typeof record.updatedBy !== "string" ||
      typeof record.sourceTool !== "string" ||
      typeof record.revision !== "number"
    ) {
      continue;
    }

    entries.push({
      markdown: record.markdown,
      verdict: record.verdict,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy,
      sourceTool: record.sourceTool,
      revision: record.revision,
    });
  }
  return entries;
};

const normalizeParentId = (issue: RawIssue): string | null => {
  if (typeof issue.parent === "string" && issue.parent.trim().length > 0) {
    return issue.parent;
  }

  if (!Array.isArray(issue.dependencies)) {
    return null;
  }

  for (const dependency of issue.dependencies) {
    if (!dependency || typeof dependency !== "object") {
      continue;
    }
    const dependencyType = dependency.dependency_type ?? dependency.type;
    if (dependencyType !== "parent-child") {
      continue;
    }
    if (
      typeof dependency.depends_on_id === "string" &&
      dependency.depends_on_id.trim().length > 0
    ) {
      return dependency.depends_on_id;
    }
    if (typeof dependency.id === "string" && dependency.id.trim().length > 0) {
      return dependency.id;
    }
  }

  return null;
};

const issueToTaskCard = (issue: RawIssue, metadataNamespace: string): TaskCard => {
  const root = parseMetadataRoot(issue.metadata);
  const namespace = ensureObject(root[metadataNamespace]);
  const qaRequired =
    typeof namespace.qaRequired === "boolean"
      ? namespace.qaRequired
      : defaultQaRequiredForIssueType(normalizeIssueType(issue.issue_type));

  return {
    id: issue.id,
    title: issue.title,
    status: toTaskStatus(issue.status),
    issueType: normalizeIssueType(issue.issue_type),
    aiReviewEnabled: qaRequired,
    parentId: normalizeParentId(issue),
  };
};

const toTaskStatus = (value: unknown): TaskStatus => {
  const normalized = typeof value === "string" ? value : "open";
  if (
    normalized === "open" ||
    normalized === "spec_ready" ||
    normalized === "ready_for_dev" ||
    normalized === "in_progress" ||
    normalized === "blocked" ||
    normalized === "ai_review" ||
    normalized === "human_review" ||
    normalized === "deferred" ||
    normalized === "closed"
  ) {
    return normalized;
  }
  return "open";
};

const canSkipSpecAndPlanning = (task: TaskCard): boolean => {
  return task.issueType === "task" || task.issueType === "bug";
};

const allowsTransition = (task: TaskCard, from: TaskStatus, to: TaskStatus): boolean => {
  if (from === to) {
    return true;
  }

  switch (from) {
    case "open": {
      if (canSkipSpecAndPlanning(task)) {
        return (
          to === "spec_ready" || to === "ready_for_dev" || to === "in_progress" || to === "deferred"
        );
      }
      return to === "spec_ready" || to === "deferred";
    }
    case "spec_ready": {
      if (canSkipSpecAndPlanning(task)) {
        return to === "ready_for_dev" || to === "in_progress" || to === "deferred";
      }
      return to === "ready_for_dev" || to === "deferred";
    }
    case "ready_for_dev":
      return to === "in_progress" || to === "deferred";
    case "in_progress":
      return to === "blocked" || to === "ai_review" || to === "human_review" || to === "deferred";
    case "blocked":
      return to === "in_progress" || to === "deferred";
    case "ai_review":
      return to === "in_progress" || to === "human_review" || to === "deferred";
    case "human_review":
      return to === "in_progress" || to === "closed" || to === "deferred";
    case "deferred":
      return to === "open";
    case "closed":
      return false;
    default:
      return false;
  }
};

const canSetSpecFromStatus = (status: TaskStatus): boolean => {
  return status === "open" || status === "spec_ready";
};

const canSetPlan = (task: TaskCard): boolean => {
  if (task.issueType === "epic" || task.issueType === "feature") {
    return task.status === "spec_ready";
  }
  return task.status === "open" || task.status === "spec_ready";
};

const normalizeTitleKey = (value: string): string => value.trim().toLowerCase();

export const normalizePlanSubtasks = (inputs: PlanSubtaskInput[]): PlanSubtaskInput[] => {
  const normalized: PlanSubtaskInput[] = [];

  for (const input of inputs) {
    const title = input.title.trim();
    if (title.length === 0) {
      throw new Error("Subtask proposals require a non-empty title.");
    }

    const issueType = normalizeIssueType(input.issueType);
    if (issueType === "epic") {
      throw new Error("Epic subtasks are not allowed.");
    }

    const priority = Math.max(0, Math.min(4, input.priority ?? 2));
    const description = input.description?.trim();

    normalized.push({
      title,
      issueType,
      priority,
      ...(description ? { description } : {}),
    });
  }

  return normalized;
};

const validatePlanSubtaskRules = (
  task: TaskCard,
  allTasks: TaskCard[],
  planSubtasks: PlanSubtaskInput[],
): void => {
  if (task.issueType !== "epic") {
    if (planSubtasks.length > 0) {
      throw new Error("Only epics can receive subtask proposals during planning.");
    }
    return;
  }

  const hasDirectSubtasks = allTasks.some((entry) => entry.parentId === task.id);
  if (!hasDirectSubtasks && planSubtasks.length === 0) {
    throw new Error("Epic plans must provide at least one direct subtask proposal.");
  }
};

const validateTransition = (
  task: TaskCard,
  allTasks: TaskCard[],
  from: TaskStatus,
  to: TaskStatus,
): void => {
  if (!allowsTransition(task, from, to)) {
    throw new Error(`Transition not allowed for ${task.id} (${task.issueType}): ${from} -> ${to}`);
  }

  if (to === "closed" && task.issueType === "epic") {
    const blockingSubtask = allTasks.find(
      (entry) =>
        entry.parentId === task.id && entry.status !== "closed" && entry.status !== "deferred",
    );

    if (blockingSubtask) {
      throw new Error(
        `Epic cannot be completed while direct subtask ${blockingSubtask.id} is still active.`,
      );
    }
  }
};

const runProcess = async (
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<{ ok: boolean; stdout: string; stderr: string }> => {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      rejectPromise(error);
    });

    child.on("close", (code) => {
      resolvePromise({
        ok: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
};

const resolveCanonicalPath = async (pathValue: string): Promise<string> => {
  const absolute = resolve(pathValue);
  try {
    return await realpath(absolute);
  } catch {
    return absolute;
  }
};

export const computeRepoId = async (repoPath: string): Promise<string> => {
  const canonical = await resolveCanonicalPath(repoPath);
  const slug = sanitizeSlug(basename(canonical));
  const digest = createHash("sha256").update(canonical).digest("hex").slice(0, 8);
  return `${slug}-${digest}`;
};

export const resolveCentralBeadsDir = async (repoPath: string): Promise<string> => {
  const repoId = await computeRepoId(repoPath);
  const root = `${homedir()}/.openblueprint/beads/${repoId}`;
  await mkdir(root, { recursive: true });
  return `${root}/.beads`;
};

type OdtStoreOptions = {
  repoPath: string;
  beadsDir?: string;
  metadataNamespace: string;
};

export class OdtTaskStore {
  readonly repoPath: string;
  readonly metadataNamespace: string;
  private beadsDir: string | null;

  constructor(options: OdtStoreOptions) {
    this.repoPath = options.repoPath;
    this.metadataNamespace = options.metadataNamespace;
    this.beadsDir = options.beadsDir ?? null;
  }

  private async ensureBeadsDir(): Promise<string> {
    if (this.beadsDir) {
      return this.beadsDir;
    }

    this.beadsDir = await resolveCentralBeadsDir(this.repoPath);
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

    const result = await runProcess("bd", finalArgs, this.repoPath, {
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

  private async transitionTask(taskId: string, next: TaskStatus): Promise<TaskCard> {
    const tasks = await this.listTasks();
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    validateTransition(task, tasks, task.status, next);

    if (task.status !== next) {
      await this.runBdJson(["update", taskId, "--status", next]);
    }

    const refreshed = await this.showRawIssue(taskId);
    return issueToTaskCard(refreshed, this.metadataNamespace);
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
    const issue = await this.showRawIssue(input.taskId);
    const task = issueToTaskCard(issue, this.metadataNamespace);
    const docs = this.parseDocs(issue);

    return {
      task,
      documents: docs,
    };
  }

  async setSpec(rawInput: unknown): Promise<unknown> {
    await this.ensureInitialized();
    const input = SetSpecInputSchema.parse(rawInput);
    const markdown = input.markdown.trim();

    const tasks = await this.listTasks();
    const task = tasks.find((entry) => entry.id === input.taskId);
    if (!task) {
      throw new Error(`Task not found: ${input.taskId}`);
    }

    if (!canSetSpecFromStatus(task.status)) {
      throw new Error(`set_spec is only allowed from open/spec_ready (current: ${task.status})`);
    }

    const issue = await this.showRawIssue(input.taskId);
    const { root, namespace, documents } = this.getNamespaceData(issue);
    const nextRevision = (parseMarkdownEntries(documents.spec).at(-1)?.revision ?? 0) + 1;

    const updatedAt = nowIso();
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

    await this.writeNamespace(input.taskId, root, nextNamespace);

    const nextTask =
      task.status === "open" ? await this.transitionTask(input.taskId, "spec_ready") : task;

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

    const tasks = await this.listTasks();
    const task = tasks.find((entry) => entry.id === input.taskId);
    if (!task) {
      throw new Error(`Task not found: ${input.taskId}`);
    }

    if (!canSetPlan(task)) {
      throw new Error(
        `set_plan is not allowed for issue type ${task.issueType} from status ${task.status}`,
      );
    }

    const normalizedSubtasks = normalizePlanSubtasks(input.subtasks ?? []);
    validatePlanSubtaskRules(task, tasks, normalizedSubtasks);

    const issue = await this.showRawIssue(input.taskId);
    const { root, namespace, documents } = this.getNamespaceData(issue);
    const nextRevision =
      (parseMarkdownEntries(documents.implementationPlan).at(-1)?.revision ?? 0) + 1;

    const updatedAt = nowIso();
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

    await this.writeNamespace(input.taskId, root, nextNamespace);

    const createdSubtaskIds: string[] = [];
    if (task.issueType === "epic" && normalizedSubtasks.length > 0) {
      const existingTaskSnapshot = await this.listTasks();
      const existingTitleKeys = new Set(
        existingTaskSnapshot
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
    }

    const nextTask = await this.transitionTask(task.id, "ready_for_dev");

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

    const tasks = await this.listTasks();
    const task = tasks.find((entry) => entry.id === input.taskId);
    if (!task) {
      throw new Error(`Task not found: ${input.taskId}`);
    }

    const nextStatus: TaskStatus = task.aiReviewEnabled ? "ai_review" : "human_review";
    const updated = await this.transitionTask(input.taskId, nextStatus);
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
      updatedAt: nowIso(),
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
    await this.appendQaReport(input.taskId, input.reportMarkdown.trim(), "approved");
    const task = await this.transitionTask(input.taskId, "human_review");
    return { task };
  }

  async qaRejected(rawInput: unknown): Promise<unknown> {
    await this.ensureInitialized();
    const input = QaRejectedInputSchema.parse(rawInput);
    await this.appendQaReport(input.taskId, input.reportMarkdown.trim(), "rejected");
    const task = await this.transitionTask(input.taskId, "in_progress");
    return { task };
  }
}

export type OdtStoreContext = {
  repoPath?: string;
  beadsDir?: string;
  metadataNamespace?: string;
};

export const resolveStoreContext = async (context: OdtStoreContext): Promise<OdtStoreOptions> => {
  const repoPath = (context.repoPath ?? process.env.ODT_REPO_PATH ?? process.cwd()).trim();
  if (!repoPath) {
    throw new Error("Missing repository path for OpenDucktor MCP.");
  }

  const normalizedRepoPath = await resolveCanonicalPath(repoPath);
  const metadataNamespace =
    context.metadataNamespace?.trim() ||
    process.env.ODT_METADATA_NAMESPACE?.trim() ||
    "openducktor";

  const beadsDir =
    context.beadsDir?.trim() || process.env.ODT_BEADS_DIR?.trim() || process.env.BEADS_DIR?.trim();

  return {
    repoPath: normalizedRepoPath,
    metadataNamespace,
    ...(beadsDir ? { beadsDir } : {}),
  };
};
