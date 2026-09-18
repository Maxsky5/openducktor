import {
  type BuildBlockedResult,
  type BuildCompletedResult,
  type BuildResumedResult,
  type CreateTaskResult,
  type GetWorkspacesResult,
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_MCP_TOOL_NAMES,
  ODT_TOOL_SCHEMAS,
  type OdtHostBridgeReady,
  type QaApprovedResult,
  type QaRejectedResult,
  type ReadTaskAssetsResult,
  type SearchTasksResult,
  type SetPlanResult,
  type SetPullRequestResult,
  type SetSpecResult,
  type TaskDocumentsRead,
  type TaskSummary,
  type WorkspaceScopedOdtToolName,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { JSONType } from "zod";
import { parseResponse, parseToolInput } from "./odt-mcp-bridge-model";
import { executeOdtMcpMutationTool } from "./odt-mcp-bridge-mutation-tools";
import { executeOdtMcpReadTool } from "./odt-mcp-bridge-read-tools";
import {
  createOdtMcpToolContext,
  type CreateOdtMcpToolContextInput,
  type OdtMcpBridgeError,
  type OdtMcpReadToolName,
} from "./odt-mcp-bridge-tool-context";

export type { OdtMcpBridgeError } from "./odt-mcp-bridge-tool-context";

const RESPONSE_SCHEMAS = ODT_HOST_BRIDGE_RESPONSE_SCHEMAS;

const READ_TOOL_NAMES: ReadonlySet<WorkspaceScopedOdtToolName> = new Set([
  "odt_read_task",
  "odt_read_task_assets",
  "odt_read_task_documents",
  "odt_search_tasks",
]);

const isOdtMcpReadToolName = (
  toolName: WorkspaceScopedOdtToolName,
): toolName is OdtMcpReadToolName => READ_TOOL_NAMES.has(toolName);

export type WorkspaceScopedOdtToolResult =
  | BuildBlockedResult
  | BuildCompletedResult
  | BuildResumedResult
  | CreateTaskResult
  | QaApprovedResult
  | QaRejectedResult
  | ReadTaskAssetsResult
  | SearchTasksResult
  | SetPlanResult
  | SetPullRequestResult
  | SetSpecResult
  | TaskDocumentsRead
  | TaskSummary;

export type OdtMcpBridgeService = {
  ready(input?: JSONType): Effect.Effect<OdtHostBridgeReady, OdtMcpBridgeError>;
  getWorkspaces(input?: JSONType): Effect.Effect<GetWorkspacesResult, OdtMcpBridgeError>;
  invoke(
    toolName: WorkspaceScopedOdtToolName,
    input: JSONType,
  ): Effect.Effect<WorkspaceScopedOdtToolResult, OdtMcpBridgeError>;
};
export type CreateOdtMcpBridgeServiceInput = CreateOdtMcpToolContextInput;
export const createOdtMcpBridgeService = (
  input: CreateOdtMcpBridgeServiceInput,
): OdtMcpBridgeService => {
  const context = createOdtMcpToolContext(input);
  const service: OdtMcpBridgeService = {
    ready() {
      return Effect.succeed({ bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] });
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
  };
  return service;
};
