import {
  type GetWorkspacesResult,
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_MCP_BRIDGE_VERSION,
  ODT_MCP_TOOL_NAMES,
  ODT_TOOL_SCHEMAS,
  type OdtBrowserToolName,
  type OdtBrowserToolResult,
  type OdtHostBridgeReady,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { JSONType, z } from "zod";
import {
  executeOdtMcpBrowserTool,
  type OdtMcpBrowserBridgeError,
} from "./odt-mcp-bridge-browser-tools";
import { parseResponse, parseToolInput } from "./odt-mcp-bridge-model";
import { executeOdtMcpMutationTool } from "./odt-mcp-bridge-mutation-tools";
import { executeOdtMcpReadTool } from "./odt-mcp-bridge-read-tools";
import {
  createOdtMcpToolContext,
  type CreateOdtMcpToolContextInput,
  ODT_MCP_READ_TOOL_NAMES,
  type OdtMcpBridgeError,
  type OdtMcpReadToolName,
  type OdtMcpTaskToolName,
} from "./odt-mcp-bridge-tool-context";

export type { OdtMcpBrowserBridgeError } from "./odt-mcp-bridge-browser-tools";
export type { OdtMcpBridgeError, OdtMcpTaskToolName } from "./odt-mcp-bridge-tool-context";

export type WorkspaceScopedOdtToolResult = z.output<
  (typeof ODT_HOST_BRIDGE_RESPONSE_SCHEMAS)[OdtMcpTaskToolName]
>;

export type OdtMcpBridgeService = {
  ready(input?: JSONType): Effect.Effect<OdtHostBridgeReady, OdtMcpBridgeError>;
  getWorkspaces(input?: JSONType): Effect.Effect<GetWorkspacesResult, OdtMcpBridgeError>;
  invoke(
    toolName: OdtMcpTaskToolName,
    input: JSONType,
  ): Effect.Effect<WorkspaceScopedOdtToolResult, OdtMcpBridgeError>;
  /** `input` is the tool input plus `workspaceId` and the calling runtime session. */
  invokeBrowserTool(
    toolName: OdtBrowserToolName,
    input: JSONType,
  ): Effect.Effect<OdtBrowserToolResult, OdtMcpBrowserBridgeError>;
};
export const createOdtMcpBridgeService = (
  input: CreateOdtMcpToolContextInput,
): OdtMcpBridgeService => {
  const context = createOdtMcpToolContext(input);
  return {
    ready() {
      return Effect.succeed({
        bridgeVersion: ODT_MCP_BRIDGE_VERSION,
        toolNames: [...ODT_MCP_TOOL_NAMES],
      });
    },
    getWorkspaces(input) {
      return Effect.gen(function* () {
        yield* parseToolInput(
          "odt_get_workspaces",
          ODT_TOOL_SCHEMAS.odt_get_workspaces,
          input ?? {},
        );
        return yield* parseResponse("odt_get_workspaces", RESPONSE_SCHEMAS.odt_get_workspaces, {
          workspaces: yield* context.workspaceSettingsService.listWorkspaces(),
        });
      });
    },
    invoke(toolName, input) {
      return Effect.gen(function* () {
        if (isOdtMcpReadToolName(toolName)) {
          return yield* executeOdtMcpReadTool(context, toolName, input);
        }
        return yield* executeOdtMcpMutationTool(context, toolName, input);
      });
    },
    invokeBrowserTool(toolName, input) {
      return executeOdtMcpBrowserTool(context, toolName, input);
    },
  };
};

const RESPONSE_SCHEMAS = ODT_HOST_BRIDGE_RESPONSE_SCHEMAS;

const READ_TOOL_NAMES: ReadonlySet<OdtMcpTaskToolName> = new Set(ODT_MCP_READ_TOOL_NAMES);

const isOdtMcpReadToolName = (toolName: OdtMcpTaskToolName): toolName is OdtMcpReadToolName =>
  READ_TOOL_NAMES.has(toolName);
