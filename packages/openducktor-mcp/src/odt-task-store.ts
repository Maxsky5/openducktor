import type { RequestMeta } from "@modelcontextprotocol/sdk/types.js";
import {
  ODT_TOOL_SCHEMAS,
  TASK_ARTIFACT_MAX_FILE_BYTES,
  type OdtBrowserToolName,
  type OdtToolName,
  type WorkspaceScopedOdtToolName,
} from "@openducktor/contracts";
import type { z } from "zod";
import { requireRuntimeCaller, type RuntimeCallerResolver } from "./runtime-caller";
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
/**
 * Task tools that name the calling session of a managed runtime, so the host keeps a task session
 * on its own task. A call from a user client names no caller.
 */
export type CallerToolName =
  | "odt_read_task"
  | "odt_read_task_artifacts"
  | "odt_read_task_assets"
  | "odt_delete_task_artifact"
  | "odt_apply_workflow_event";
export type PlainWorkspaceToolName = Exclude<
  WorkspaceTaskToolName,
  "odt_set_task_artifact" | "odt_publish_html" | CallerToolName
>;

export class OdtTaskStore {
  readonly workspaceId: string | undefined;
  private readonly resolveCaller: RuntimeCallerResolver | undefined;
  private readonly client: OdtHostBridgeClientPort;

  constructor(options: Omit<OdtStoreOptions, "activeStatuses">, deps: OdtTaskStoreDeps = {}) {
    this.workspaceId = options.workspaceId;
    this.resolveCaller = options.resolveCaller;
    this.client =
      deps.client ??
      new OdtHostBridgeClient({ baseUrl: options.hostUrl, appToken: options.hostToken });
  }

  private resolveWorkspaceId(
    toolName: WorkspaceScopedOdtToolName,
    input: Pick<ToolInput<WorkspaceScopedOdtToolName>, "workspaceId">,
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

  async callWorkspaceTask<Name extends PlainWorkspaceToolName>(
    toolName: Name,
    input: ToolInput<Name>,
  ) {
    const workspaceId = this.resolveWorkspaceId(toolName, input);
    return this.client.call(toolName, workspaceId, input);
  }

  async callWithCaller<Name extends CallerToolName>(
    toolName: Name,
    input: ToolInput<Name>,
    meta: RequestMeta | undefined,
  ) {
    const caller = this.resolveCaller?.(meta);
    const workspaceId = this.resolveWorkspaceId(toolName, input);
    return this.client.call(toolName, workspaceId, input, caller);
  }

  /** `meta` is the `_meta` of the MCP request. OpenCode and Codex name the calling session there. */
  async callBrowserTool<Name extends OdtBrowserToolName>(
    toolName: Name,
    input: ToolInput<Name>,
    meta: RequestMeta | undefined,
  ) {
    const caller = requireRuntimeCaller(this.resolveCaller, meta);
    const workspaceId = this.resolveWorkspaceId(toolName, input);
    return this.client.callBrowserTool(toolName, workspaceId, input, caller);
  }

  async getWorkspaces() {
    return this.client.getWorkspaces();
  }

  async setTaskArtifact(input: ToolInput<"odt_set_task_artifact">, meta?: RequestMeta) {
    const caller = this.resolveCaller?.(meta);
    const { content, ...bridgeInput } = input;
    const dataBase64 = toBridgeArtifactBase64(content, input.dataBase64);
    if (dataBase64 !== undefined) {
      bridgeInput.dataBase64 = dataBase64;
    }
    const workspaceId = this.resolveWorkspaceId("odt_set_task_artifact", input);
    return this.client.call("odt_set_task_artifact", workspaceId, bridgeInput, caller);
  }

  async publishHtml(input: ToolInput<"odt_publish_html">, meta: RequestMeta | undefined) {
    const caller = requireRuntimeCaller(this.resolveCaller, meta);
    const workspaceId = this.resolveWorkspaceId("odt_publish_html", input);
    return this.client.call("odt_publish_html", workspaceId, input, caller);
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
