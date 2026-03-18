import type { BdRuntimeClient } from "./bd-runtime-client";
import { isNonTaskBeadsIssueType } from "./beads-task-parsing";
import type { IssueType, JsonObject, RawIssue, TaskCard, TaskStatus } from "./contracts";
import { getNamespaceData, type NamespaceData } from "./metadata-docs";
import { issueToTaskCard } from "./task-mapping";

export type TaskUpdateInput = {
  status?: TaskStatus;
  metadataRoot?: JsonObject;
};

export type TaskSearchFilters = {
  priority?: number;
  issueType?: IssueType;
  status?: TaskStatus;
  title?: string;
  tags?: string[];
};

export type PublicTaskCreateInput = {
  title: string;
  issueType: "task" | "feature" | "bug";
  priority: number;
  description?: string;
  labels?: string[];
  aiReviewEnabled?: boolean;
};

const normalizeLabels = (labels: string[]): string[] => {
  const deduped = new Set<string>();
  for (const entry of labels) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }
    deduped.add(trimmed);
  }

  return Array.from(deduped).sort((left, right) => left.localeCompare(right));
};

const normalizeText = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export type TaskPersistencePort = {
  metadataNamespace: string;
  runBdJson(args: string[]): Promise<unknown>;
  ensureInitialized(): Promise<void>;
  showRawIssue(taskId: string): Promise<RawIssue>;
  listRawIssues(filters?: TaskSearchFilters): Promise<RawIssue[]>;
  createTask(input: PublicTaskCreateInput): Promise<RawIssue>;
  listTasks(filters?: TaskSearchFilters): Promise<TaskCard[]>;
  updateTask(taskId: string, input: TaskUpdateInput): Promise<void>;
  getNamespaceData(issue: RawIssue): NamespaceData;
  writeNamespace(taskId: string, root: JsonObject, namespace: JsonObject): Promise<void>;
};

export class BdPersistence implements TaskPersistencePort {
  readonly metadataNamespace: string;
  private readonly bdClient: BdRuntimeClient;

  constructor(bdClient: BdRuntimeClient, metadataNamespace: string) {
    this.bdClient = bdClient;
    this.metadataNamespace = metadataNamespace;
  }

  async runBdJson(args: string[]): Promise<unknown> {
    if (args[0] === "update") {
      return this.bdClient.updateTask(args);
    }
    return this.bdClient.runBdJson(args);
  }

  async ensureInitialized(): Promise<void> {
    await this.bdClient.ensureInitialized();
  }

  async showRawIssue(taskId: string): Promise<RawIssue> {
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

  async listRawIssues(filters: TaskSearchFilters = {}): Promise<RawIssue[]> {
    const args = ["list", "--all", "--limit", "0"];
    if (typeof filters.priority === "number") {
      args.push("--priority", String(filters.priority));
    }
    if (filters.issueType) {
      args.push("--type", filters.issueType);
    }
    if (filters.status) {
      args.push("--status", filters.status);
    }
    const title = normalizeText(filters.title);
    if (title) {
      args.push("--title-contains", title);
    }
    const tags = normalizeLabels(filters.tags ?? []);
    for (const tag of tags) {
      args.push("--label", tag);
    }

    const payload = await this.runBdJson(args);
    if (!Array.isArray(payload)) {
      throw new Error("bd list did not return an array");
    }

    return payload
      .filter((entry) => entry && typeof entry === "object")
      .filter((entry) => !isNonTaskBeadsIssueType((entry as RawIssue).issue_type))
      .map((entry) => entry as RawIssue);
  }

  async createTask(input: PublicTaskCreateInput): Promise<RawIssue> {
    const args = [
      "create",
      input.title,
      "--type",
      input.issueType,
      "--priority",
      String(input.priority),
    ];
    const description = normalizeText(input.description);
    if (description) {
      args.push("--description", description);
    }

    const labels = normalizeLabels(input.labels ?? []);
    if (labels.length > 0) {
      args.push("--labels", labels.join(","));
    }

    const payload = await this.runBdJson(args);
    if (!payload || typeof payload !== "object") {
      throw new Error("bd create did not return an issue payload");
    }
    const issueId = (payload as { id?: unknown }).id;
    if (typeof issueId !== "string" || issueId.trim().length === 0) {
      throw new Error("bd create did not return a task id");
    }

    const createdTaskId = issueId.trim();
    try {
      const createdIssue = await this.showRawIssue(createdTaskId);
      const { root, namespace } = this.getNamespaceData(createdIssue);
      await this.writeNamespace(createdTaskId, root, {
        ...namespace,
        qaRequired: input.aiReviewEnabled ?? true,
      });

      return await this.showRawIssue(createdTaskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Task ${createdTaskId} was created, but post-create metadata sync failed: ${message}`,
      );
    }
  }

  async listTasks(filters: TaskSearchFilters = {}): Promise<TaskCard[]> {
    const payload = await this.listRawIssues(filters);

    return payload.map((entry) => issueToTaskCard(entry as RawIssue, this.metadataNamespace));
  }

  getNamespaceData(issue: RawIssue): NamespaceData {
    return getNamespaceData(issue, this.metadataNamespace);
  }

  async updateTask(taskId: string, input: TaskUpdateInput): Promise<void> {
    const args = ["update", taskId];

    if (input.status) {
      args.push("--status", input.status);
    }

    if (input.metadataRoot) {
      args.push("--metadata", JSON.stringify(input.metadataRoot));
    }

    if (args.length === 2) {
      return;
    }

    await this.runBdJson(args);
  }

  async writeNamespace(taskId: string, root: JsonObject, namespace: JsonObject): Promise<void> {
    const nextRoot = {
      ...root,
      [this.metadataNamespace]: namespace,
    };

    await this.updateTask(taskId, { metadataRoot: nextRoot });
  }
}
