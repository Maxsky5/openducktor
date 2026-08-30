import {
  ODT_TOOL_SCHEMAS,
  type OdtToolName,
  type WorkspaceScopedOdtToolName,
} from "@openducktor/contracts";
import type { z } from "zod";
import { OdtHostBridgeClient, type OdtHostBridgeClientPort } from "./host-bridge-client";
import type { OdtStoreOptions } from "./store-context";
import { OdtToolError } from "./tool-results";

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
    input: Pick<ToolInput<WorkspaceScopedToolName>, "workspaceId">,
  ): string {
    const workspaceId = input.workspaceId ?? this.workspaceId;
    if (workspaceId) {
      return workspaceId;
    }

    throw new OdtToolError({
      code: "ODT_WORKSPACE_MISSING",
      message: `Missing workspaceId for workspace-scoped tool '${toolName}'. Start @openducktor/mcp with --workspace-id or provide workspaceId in the tool input.`,
      details: { toolName },
    });
  }

  private async executeWorkspaceScoped<Name extends WorkspaceScopedToolName>(
    toolName: Name,
    input: ToolInput<Name>,
  ) {
    const workspaceId = this.resolveWorkspaceId(toolName, input);
    return this.client.call(toolName, workspaceId, input);
  }

  async getWorkspaces(_input: ToolInput<"odt_get_workspaces">) {
    return this.client.getWorkspaces();
  }

  async readTask(input: ToolInput<"odt_read_task">) {
    return this.executeWorkspaceScoped("odt_read_task", input);
  }

  async readTaskAssets(input: ToolInput<"odt_read_task_assets">) {
    return this.executeWorkspaceScoped("odt_read_task_assets", input);
  }

  async readTaskDocuments(input: ToolInput<"odt_read_task_documents">) {
    return this.executeWorkspaceScoped("odt_read_task_documents", input);
  }

  async createTask(input: ToolInput<"odt_create_task">) {
    return this.executeWorkspaceScoped("odt_create_task", input);
  }

  async searchTasks(input: ToolInput<"odt_search_tasks">) {
    return this.executeWorkspaceScoped("odt_search_tasks", input);
  }

  async setSpec(input: ToolInput<"odt_set_spec">) {
    return this.executeWorkspaceScoped("odt_set_spec", input);
  }

  async setPlan(input: ToolInput<"odt_set_plan">) {
    return this.executeWorkspaceScoped("odt_set_plan", input);
  }

  async buildBlocked(input: ToolInput<"odt_build_blocked">) {
    return this.executeWorkspaceScoped("odt_build_blocked", input);
  }

  async buildResumed(input: ToolInput<"odt_build_resumed">) {
    return this.executeWorkspaceScoped("odt_build_resumed", input);
  }

  async buildCompleted(input: ToolInput<"odt_build_completed">) {
    return this.executeWorkspaceScoped("odt_build_completed", input);
  }

  async setPullRequest(input: ToolInput<"odt_set_pull_request">) {
    return this.executeWorkspaceScoped("odt_set_pull_request", input);
  }

  async qaApproved(input: ToolInput<"odt_qa_approved">) {
    return this.executeWorkspaceScoped("odt_qa_approved", input);
  }

  async qaRejected(input: ToolInput<"odt_qa_rejected">) {
    return this.executeWorkspaceScoped("odt_qa_rejected", input);
  }
}
