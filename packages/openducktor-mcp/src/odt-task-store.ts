import {
  ODT_TOOL_SCHEMAS,
  type OdtToolName,
  type WorkspaceScopedOdtToolName,
} from "@openducktor/contracts";
import type { z } from "zod";
import { OdtHostBridgeClient, type OdtHostBridgeClientPort } from "./host-bridge-client";
import type { OdtStoreOptions } from "./store-context";

export type OdtTaskStoreDeps = {
  client?: OdtHostBridgeClientPort;
};

type ToolInput<Name extends OdtToolName> = z.infer<(typeof ODT_TOOL_SCHEMAS)[Name]>;
type WorkspaceScopedToolName = WorkspaceScopedOdtToolName;

export class OdtTaskStore {
  readonly workspaceId: string | undefined;
  private readonly client: OdtHostBridgeClientPort;

  constructor(options: OdtStoreOptions, deps: OdtTaskStoreDeps = {}) {
    this.workspaceId = options.workspaceId;
    this.client =
      deps.client ??
      new OdtHostBridgeClient({ baseUrl: options.hostUrl, appToken: options.hostToken });
  }

  private resolveWorkspaceId(
    toolName: WorkspaceScopedToolName,
    input: { workspaceId?: string },
  ): string {
    const workspaceId = input.workspaceId ?? this.workspaceId;
    if (workspaceId) {
      return workspaceId;
    }

    throw new Error(
      `Missing workspaceId for workspace-scoped tool '${toolName}'. Start @openducktor/mcp with --workspace-id or provide workspaceId in the tool input.`,
    );
  }

  private async executeWorkspaceScoped<Name extends WorkspaceScopedToolName>(
    toolName: Name,
    rawInput: unknown,
  ) {
    const parsed = ODT_TOOL_SCHEMAS[toolName].parse(rawInput) as ToolInput<Name>;
    const workspaceId = this.resolveWorkspaceId(toolName, parsed as { workspaceId?: string });
    return this.client.call(toolName, workspaceId, parsed);
  }

  async getWorkspaces(rawInput: unknown) {
    ODT_TOOL_SCHEMAS.odt_get_workspaces.parse(rawInput);
    return this.client.getWorkspaces();
  }

  async readTask(rawInput: unknown) {
    return this.executeWorkspaceScoped("odt_read_task", rawInput);
  }

  async readTaskDocuments(rawInput: unknown) {
    return this.executeWorkspaceScoped("odt_read_task_documents", rawInput);
  }

  async createTask(rawInput: unknown) {
    return this.executeWorkspaceScoped("odt_create_task", rawInput);
  }

  async searchTasks(rawInput: unknown) {
    return this.executeWorkspaceScoped("odt_search_tasks", rawInput);
  }

  async setSpec(rawInput: unknown) {
    return this.executeWorkspaceScoped("odt_set_spec", rawInput);
  }

  async setPlan(rawInput: unknown) {
    return this.executeWorkspaceScoped("odt_set_plan", rawInput);
  }

  async buildBlocked(rawInput: unknown) {
    return this.executeWorkspaceScoped("odt_build_blocked", rawInput);
  }

  async buildResumed(rawInput: unknown) {
    return this.executeWorkspaceScoped("odt_build_resumed", rawInput);
  }

  async buildCompleted(rawInput: unknown) {
    return this.executeWorkspaceScoped("odt_build_completed", rawInput);
  }

  async setPullRequest(rawInput: unknown) {
    return this.executeWorkspaceScoped("odt_set_pull_request", rawInput);
  }

  async qaApproved(rawInput: unknown) {
    return this.executeWorkspaceScoped("odt_qa_approved", rawInput);
  }

  async qaRejected(rawInput: unknown) {
    return this.executeWorkspaceScoped("odt_qa_rejected", rawInput);
  }
}
