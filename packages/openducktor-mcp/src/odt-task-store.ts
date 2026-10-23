import type { RequestMeta } from "@modelcontextprotocol/sdk/types.js";
import {
  ODT_TOOL_SCHEMAS,
  TASK_ARTIFACT_MAX_FILE_BYTES,
  type OdtBrowserToolName,
  type OdtToolName,
  type WorkspaceScopedOdtToolName,
} from "@openducktor/contracts";
import type { z } from "zod";
import { type RuntimeCallerSource, resolveNativeCaller } from "./runtime-caller";
import {
  OdtHostBridgeClient,
  type OdtHostBridgeClientPort,
  type WorkspaceTaskToolName,
} from "./host-bridge-client";
import type { OdtStoreOptions } from "./store-context";
import { OdtToolError } from "./tool-results";

export type OdtTaskStoreDeps = {
  client?: OdtHostBridgeClientPort;
};

type ToolInput<Name extends OdtToolName> = z.infer<(typeof ODT_TOOL_SCHEMAS)[Name]>;
type WorkspaceScopedToolName = WorkspaceScopedOdtToolName;

export class OdtTaskStore {
  readonly workspaceId: string | undefined;
  private readonly callerSource: RuntimeCallerSource | undefined;
  private readonly client: OdtHostBridgeClientPort;

  constructor(options: OdtStoreOptions, deps: OdtTaskStoreDeps = {}) {
    this.workspaceId = options.workspaceId;
    this.callerSource = options.callerSource;
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

  private async executeWorkspaceScoped<Name extends WorkspaceTaskToolName>(
    toolName: Name,
    input: ToolInput<Name>,
  ) {
    const workspaceId = this.resolveWorkspaceId(toolName, input);
    return this.client.call(toolName, workspaceId, input);
  }

  /** `meta` is the `_meta` of the MCP request. OpenCode and Codex name the calling session there. */
  async callBrowserTool<Name extends OdtBrowserToolName>(
    toolName: Name,
    input: ToolInput<Name>,
    meta: RequestMeta | undefined,
  ) {
    const caller = resolveNativeCaller(this.callerSource, meta);
    const workspaceId = this.resolveWorkspaceId(toolName, input);
    return this.client.callBrowserTool(toolName, workspaceId, input, caller);
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

  async readTaskArtifacts(input: ToolInput<"odt_read_task_artifacts">) {
    return this.executeWorkspaceScoped("odt_read_task_artifacts", input);
  }

  async setTaskArtifact(input: ToolInput<"odt_set_task_artifact">, meta?: RequestMeta) {
    const caller = this.callerSource ? resolveNativeCaller(this.callerSource, meta) : undefined;
    const { content, ...bridgeInput } = input;
    const dataBase64 = toBridgeArtifactBase64(content, input.dataBase64);
    if (dataBase64 !== undefined) {
      bridgeInput.dataBase64 = dataBase64;
    }
    const workspaceId = this.resolveWorkspaceId("odt_set_task_artifact", input);
    return this.client.call("odt_set_task_artifact", workspaceId, bridgeInput, caller);
  }

  async deleteTaskArtifact(input: ToolInput<"odt_delete_task_artifact">, meta?: RequestMeta) {
    const caller = this.callerSource ? resolveNativeCaller(this.callerSource, meta) : undefined;
    const workspaceId = this.resolveWorkspaceId("odt_delete_task_artifact", input);
    return this.client.call("odt_delete_task_artifact", workspaceId, input, caller);
  }

  async updateTask(input: ToolInput<"odt_update_task">) {
    return this.executeWorkspaceScoped("odt_update_task", input);
  }

  async createTask(input: ToolInput<"odt_create_task">) {
    return this.executeWorkspaceScoped("odt_create_task", input);
  }

  async searchTasks(input: ToolInput<"odt_search_tasks">) {
    return this.executeWorkspaceScoped("odt_search_tasks", input);
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
}

const toBridgeArtifactBase64 = (content: string | undefined, dataBase64: string | undefined) => {
  let bytes: Buffer;
  if (content !== undefined) {
    bytes = Buffer.from(content, "utf8");
    if (bytes.toString("utf8") !== content) {
      throw new OdtToolError({
        code: "ODT_TOOL_INPUT_INVALID",
        message:
          "Artifact text contains an unpaired Unicode surrogate. Supply valid UTF-8 text or exact base64 bytes.",
      });
    }
  } else if (dataBase64 !== undefined) {
    bytes = Buffer.from(dataBase64, "base64");
    if (bytes.toString("base64") !== dataBase64) {
      throw new OdtToolError({
        code: "ODT_TOOL_INPUT_INVALID",
        message:
          "Artifact content is not canonical base64. Encode the original bytes as padded base64.",
      });
    }
  } else {
    return undefined;
  }
  if (bytes.byteLength > TASK_ARTIFACT_MAX_FILE_BYTES) {
    throw new OdtToolError({
      code: "ODT_TOOL_INPUT_INVALID",
      message: "Artifact content exceeds 10 MiB. Choose a smaller file.",
    });
  }
  return bytes.toString("base64");
};
