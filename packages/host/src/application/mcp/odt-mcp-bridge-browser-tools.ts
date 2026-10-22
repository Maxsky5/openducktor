import {
  ODT_BROWSER_TOOL_SCHEMAS,
  odtBrowserCallerSchema,
  type OdtBrowserToolName,
  type OdtBrowserToolResult,
  odtBrowserToolResultSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { type JSONType, z } from "zod";
import { HostValidationError } from "../../effect/host-errors";
import type { BrowserCallerResolverError } from "../browser/browser-caller-resolver";
import type { BrowserServiceError } from "../browser/browser-service-error";
import { parseResponse, parseToolInput } from "./odt-mcp-bridge-model";
import type { OdtMcpBridgeError, OdtMcpToolContext } from "./odt-mcp-bridge-tool-context";

export type OdtMcpBrowserBridgeError =
  | OdtMcpBridgeError
  | BrowserCallerResolverError
  | BrowserServiceError;

const browserBridgeBodySchema = z.record(z.string(), z.json());

/**
 * Runs one browser tool for the task or Workspace Session of the calling runtime session.
 * The MCP server adds `workspaceId` and `caller` to the tool input. Tool input never selects
 * the owner.
 */
export const executeOdtMcpBrowserTool = (
  context: OdtMcpToolContext,
  toolName: OdtBrowserToolName,
  body: JSONType,
): Effect.Effect<OdtBrowserToolResult, OdtMcpBrowserBridgeError> =>
  Effect.gen(function* () {
    const { caller: rawCaller, ...toolBody } = yield* parseToolInput(
      toolName,
      browserBridgeBodySchema,
      body,
    );
    const caller = yield* parseToolInput(toolName, odtBrowserCallerSchema, rawCaller ?? null);
    const input = yield* parseToolInput(toolName, ODT_BROWSER_TOOL_SCHEMAS[toolName], toolBody);
    if (input.workspaceId === undefined) {
      return yield* new HostValidationError({
        field: "workspaceId",
        message: `Browser tool ${toolName} needs the workspaceId of the calling session.`,
      });
    }
    const owner = yield* context.browserCallers.resolve({
      workspaceId: input.workspaceId,
      caller,
    });
    const result = yield* context.browserAgentTools.runAgentTool(owner, toolName, input);
    return yield* parseResponse(toolName, odtBrowserToolResultSchema, result);
  });
