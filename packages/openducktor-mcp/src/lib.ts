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
const EMPTY_ENV_SENTINELS = new Set(["undefined", "null"]);

const normalizeOptionalInput = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (EMPTY_ENV_SENTINELS.has(trimmed.toLowerCase())) {
    return undefined;
  }
  return trimmed;
};

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

const TASK_STATUS_VALUES: readonly TaskStatus[] = [
  "open",
  "spec_ready",
  "ready_for_dev",
  "in_progress",
  "blocked",
  "ai_review",
  "human_review",
  "deferred",
  "closed",
];

const TASK_STATUS_SET = new Set<TaskStatus>(TASK_STATUS_VALUES);

const isTaskStatus = (value: string): value is TaskStatus =>
  TASK_STATUS_SET.has(value as TaskStatus);

const toTaskStatus = (value: unknown): TaskStatus => {
  if (typeof value !== "string") {
    return "open";
  }
  return isTaskStatus(value) ? value : "open";
};

const canSkipSpecAndPlanning = (task: TaskCard): boolean => {
  return task.issueType === "task" || task.issueType === "bug";
};

const BASE_TRANSITION_RULES: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  open: ["spec_ready", "deferred"],
  spec_ready: ["ready_for_dev", "deferred"],
  ready_for_dev: ["in_progress", "deferred"],
  in_progress: ["blocked", "ai_review", "human_review", "deferred"],
  blocked: ["in_progress", "deferred"],
  ai_review: ["in_progress", "human_review", "deferred"],
  human_review: ["in_progress", "closed", "deferred"],
  deferred: ["open"],
  closed: [],
};

const SKIP_SPEC_AND_PLAN_TRANSITION_EXTRAS: Readonly<
  Partial<Record<TaskStatus, readonly TaskStatus[]>>
> = {
  open: ["ready_for_dev", "in_progress"],
  spec_ready: ["in_progress"],
};

const SET_SPEC_ALLOWED_STATUSES: readonly TaskStatus[] = ["open", "spec_ready"];

const SET_PLAN_ALLOWED_STATUSES: Readonly<Record<IssueType, readonly TaskStatus[]>> = {
  epic: ["spec_ready"],
  feature: ["spec_ready"],
  task: ["open", "spec_ready"],
  bug: ["open", "spec_ready"],
};

const isStatusAllowed = (status: TaskStatus, allowed: readonly TaskStatus[]): boolean => {
  return allowed.includes(status);
};

const getTransitionError = (
  task: TaskCard,
  allTasks: TaskCard[],
  from: TaskStatus,
  to: TaskStatus,
): string | null => {
  if (from === to) {
    return null;
  }

  const baseAllowed = BASE_TRANSITION_RULES[from] ?? [];
  const extraAllowed = canSkipSpecAndPlanning(task)
    ? (SKIP_SPEC_AND_PLAN_TRANSITION_EXTRAS[from] ?? [])
    : [];

  if (!isStatusAllowed(to, baseAllowed) && !isStatusAllowed(to, extraAllowed)) {
    return `Transition not allowed for ${task.id} (${task.issueType}): ${from} -> ${to}`;
  }

  if (to === "closed" && task.issueType === "epic") {
    const blockingSubtask = allTasks.find(
      (entry) =>
        entry.parentId === task.id && entry.status !== "closed" && entry.status !== "deferred",
    );

    if (blockingSubtask) {
      return `Epic cannot be completed while direct subtask ${blockingSubtask.id} is still active.`;
    }
  }

  return null;
};

const canSetSpecFromStatus = (status: TaskStatus): boolean => {
  return isStatusAllowed(status, SET_SPEC_ALLOWED_STATUSES);
};

const canSetPlan = (task: TaskCard): boolean => {
  return isStatusAllowed(task.status, SET_PLAN_ALLOWED_STATUSES[task.issueType]);
};

const getSetSpecError = (status: TaskStatus): string | null => {
  if (canSetSpecFromStatus(status)) {
    return null;
  }
  return `set_spec is only allowed from open/spec_ready (current: ${status})`;
};

const getSetPlanError = (task: TaskCard): string | null => {
  if (canSetPlan(task)) {
    return null;
  }
  return `set_plan is not allowed for issue type ${task.issueType} from status ${task.status}`;
};

const assertNoValidationError = (error: string | null): void => {
  if (error) {
    throw new Error(error);
  }
};

const normalizeTitleKey = (value: string): string => value.trim().toLowerCase();
const toSearchSlug = (value: string): string => {
  if (!/[a-z0-9]/i.test(value)) {
    return "";
  }
  return sanitizeSlug(value);
};

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
  assertNoValidationError(getTransitionError(task, allTasks, from, to));
};

type ProcessResult = { ok: boolean; stdout: string; stderr: string };
type ProcessRunner = (
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
) => Promise<ProcessResult>;
type BeadsDirResolver = (repoPath: string) => Promise<string>;
type TimeProvider = () => string;

const runProcess: ProcessRunner = async (
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<ProcessResult> => {
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
  const root = `${homedir()}/.openducktor/beads/${repoId}`;
  await mkdir(root, { recursive: true });
  return `${root}/.beads`;
};

type OdtStoreOptions = {
  repoPath: string;
  beadsDir?: string;
  metadataNamespace: string;
};

export type OdtTaskStoreDeps = {
  runProcess?: ProcessRunner;
  resolveBeadsDir?: BeadsDirResolver;
  now?: TimeProvider;
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

  private async resolveTaskContext(taskId: string): Promise<{ task: TaskCard; tasks: TaskCard[] }> {
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

  private async transitionTask(taskId: string, next: TaskStatus): Promise<TaskCard> {
    const { task, tasks } = await this.resolveTaskContext(taskId);
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

    const { task } = await this.resolveTaskContext(input.taskId);

    const nextStatus: TaskStatus = task.aiReviewEnabled ? "ai_review" : "human_review";
    const updated = await this.transitionTask(task.id, nextStatus);
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

export type OdtStoreContext = {
  repoPath?: string;
  beadsDir?: string;
  metadataNamespace?: string;
};

export const resolveStoreContext = async (context: OdtStoreContext): Promise<OdtStoreOptions> => {
  const repoPath =
    normalizeOptionalInput(context.repoPath) ??
    normalizeOptionalInput(process.env.ODT_REPO_PATH) ??
    process.cwd();
  if (!repoPath) {
    throw new Error("Missing repository path for OpenDucktor MCP.");
  }

  const normalizedRepoPath = await resolveCanonicalPath(repoPath);
  const metadataNamespace =
    normalizeOptionalInput(context.metadataNamespace) ??
    normalizeOptionalInput(process.env.ODT_METADATA_NAMESPACE) ??
    "openducktor";

  const beadsDir =
    normalizeOptionalInput(context.beadsDir) ??
    normalizeOptionalInput(process.env.ODT_BEADS_DIR) ??
    normalizeOptionalInput(process.env.BEADS_DIR);

  return {
    repoPath: normalizedRepoPath,
    metadataNamespace,
    ...(beadsDir ? { beadsDir } : {}),
  };
};
