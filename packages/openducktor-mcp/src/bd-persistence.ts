import type { BdRuntimeClient } from "./bd-runtime-client";
import { isNonTaskBeadsIssueType } from "./beads-task-parsing";
import type { JsonObject, RawIssue, TaskCard } from "./contracts";
import { getNamespaceData, type NamespaceData } from "./metadata-docs";
import { issueToTaskCard } from "./task-mapping";

export type TaskPersistencePort = {
  metadataNamespace: string;
  runBdJson(args: string[]): Promise<unknown>;
  ensureInitialized(): Promise<void>;
  showRawIssue(taskId: string): Promise<RawIssue>;
  listTasks(): Promise<TaskCard[]>;
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

  async listTasks(): Promise<TaskCard[]> {
    const payload = await this.runBdJson(["list", "--all", "-n", "500"]);
    if (!Array.isArray(payload)) {
      throw new Error("bd list did not return an array");
    }

    return payload
      .filter((entry) => entry && typeof entry === "object")
      .filter((entry) => !isNonTaskBeadsIssueType((entry as RawIssue).issue_type))
      .map((entry) => issueToTaskCard(entry as RawIssue, this.metadataNamespace));
  }

  getNamespaceData(issue: RawIssue): NamespaceData {
    return getNamespaceData(issue, this.metadataNamespace);
  }

  async writeNamespace(taskId: string, root: JsonObject, namespace: JsonObject): Promise<void> {
    const nextRoot = {
      ...root,
      [this.metadataNamespace]: namespace,
    };

    await this.runBdJson(["update", taskId, "--metadata", JSON.stringify(nextRoot)]);
  }
}
