import { ODT_TOOL_SCHEMAS, type OdtToolName } from "@openducktor/contracts";
import type { z } from "zod";
import { OdtHostBridgeClient, type OdtHostBridgeClientPort } from "./host-bridge-client";
import type { OdtStoreOptions } from "./store-context";

export type OdtTaskStoreDeps = {
  client?: OdtHostBridgeClientPort;
};

type ToolInput<Name extends OdtToolName> = z.infer<(typeof ODT_TOOL_SCHEMAS)[Name]>;

export class OdtTaskStore {
  readonly repoPath: string;
  readonly metadataNamespace: string;
  private readonly client: OdtHostBridgeClientPort;

  constructor(options: OdtStoreOptions, deps: OdtTaskStoreDeps = {}) {
    this.repoPath = options.repoPath;
    this.metadataNamespace = options.metadataNamespace;
    this.client =
      deps.client ??
      new OdtHostBridgeClient({ baseUrl: options.hostUrl, repoPath: options.repoPath });
  }

  private async execute<Name extends OdtToolName>(toolName: Name, rawInput: unknown) {
    const parsed = ODT_TOOL_SCHEMAS[toolName].parse(rawInput) as ToolInput<Name>;
    return this.client.call(toolName, parsed);
  }

  async readTask(rawInput: unknown) {
    return this.execute("odt_read_task", rawInput);
  }

  async readTaskDocuments(rawInput: unknown) {
    return this.execute("odt_read_task_documents", rawInput);
  }

  async createTask(rawInput: unknown) {
    return this.execute("odt_create_task", rawInput);
  }

  async searchTasks(rawInput: unknown) {
    return this.execute("odt_search_tasks", rawInput);
  }

  async setSpec(rawInput: unknown) {
    return this.execute("odt_set_spec", rawInput);
  }

  async setPlan(rawInput: unknown) {
    return this.execute("odt_set_plan", rawInput);
  }

  async buildBlocked(rawInput: unknown) {
    return this.execute("odt_build_blocked", rawInput);
  }

  async buildResumed(rawInput: unknown) {
    return this.execute("odt_build_resumed", rawInput);
  }

  async buildCompleted(rawInput: unknown) {
    return this.execute("odt_build_completed", rawInput);
  }

  async setPullRequest(rawInput: unknown) {
    return this.execute("odt_set_pull_request", rawInput);
  }

  async qaApproved(rawInput: unknown) {
    return this.execute("odt_qa_approved", rawInput);
  }

  async qaRejected(rawInput: unknown) {
    return this.execute("odt_qa_rejected", rawInput);
  }
}
