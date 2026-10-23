import {
  type GetWorkspacesResult,
  ODT_BROWSER_BRIDGE_TIMEOUT_MS,
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_TOOL_SCHEMAS,
  type OdtBrowserCaller,
  type OdtBrowserToolName,
  type OdtBrowserToolResult,
  type OdtHostBridgeReady,
  type OdtToolName,
  odtHostBridgeReadySchema,
  odtToolErrorPayloadSchema,
  type WorkspaceScopedOdtToolName,
} from "@openducktor/contracts";
import { z } from "zod";
import { normalizeBaseUrl } from "./path-utils";
import { mcpToolPayloadSchema, type McpToolPayload, OdtToolError } from "./tool-results";

type ToolInput<Name extends OdtToolName> = z.infer<(typeof ODT_TOOL_SCHEMAS)[Name]>;
type ToolOutput<Name extends OdtToolName> = z.infer<
  (typeof ODT_HOST_BRIDGE_RESPONSE_SCHEMAS)[Name]
>;
/** Workspace task tools. Managed artifact writes also send their native caller. */
export type WorkspaceTaskToolName = Exclude<WorkspaceScopedOdtToolName, OdtBrowserToolName>;
type OdtToolInput = ToolInput<OdtToolName> & { caller?: OdtBrowserCaller };
type BrowserBridgeBody = ToolInput<OdtBrowserToolName> & {
  workspaceId: string;
  caller: OdtBrowserCaller;
};
type BridgeRequestHeaders = {
  Accept: "application/json";
  "Content-Type": "application/json";
  "x-openducktor-app-token"?: string;
};

export type OdtHostBridgeClientPort = {
  ready(): Promise<OdtHostBridgeReady>;
  getWorkspaces(): Promise<GetWorkspacesResult>;
  call<Name extends WorkspaceTaskToolName>(
    toolName: Name,
    workspaceId: string,
    input: ToolInput<Name>,
    caller?: OdtBrowserCaller,
  ): Promise<ToolOutput<Name>>;
  /** The host resolves the task or Workspace Session of the call from `caller`. */
  callBrowserTool<Name extends OdtBrowserToolName>(
    toolName: Name,
    workspaceId: string,
    input: ToolInput<Name>,
    caller: OdtBrowserCaller,
  ): Promise<OdtBrowserToolResult>;
};

export type OdtHostBridgeClientOptions = {
  baseUrl: string;
  appToken?: string | undefined;
};

export type OdtHostBridgeClientDeps = {
  fetchImpl?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 10_000;
// Allow the preview worker's ten-second limit plus cleanup and response delivery.
const ARTIFACT_READ_TIMEOUT_MS = 15_000;
const READY_TOOL_NAME = "odt_mcp_ready";
const causeTextSchema = z.string();
const causePrimitiveSchema = z.union([
  z.number(),
  z.nan(),
  z.literal(Infinity),
  z.literal(-Infinity),
  z.boolean(),
]);
const issuePathEntrySchema = z.union([z.string(), z.number()]);

const toCauseMessage = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }
  const text = causeTextSchema.safeParse(cause);
  if (text.success && text.data.trim().length > 0) {
    return text.data.trim();
  }
  const primitive = causePrimitiveSchema.safeParse(cause);
  if (primitive.success) {
    return String(primitive.data);
  }
  return "Unknown bridge error";
};

const toIssueDetails = (
  error: z.ZodError,
): Array<{
  path: Array<string | number>;
  message: string;
  code: string;
}> => {
  return error.issues.map((issue) => ({
    path: issue.path.flatMap((entry) => {
      const parsed = issuePathEntrySchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    }),
    message: issue.message,
    code: issue.code,
  }));
};

const parseHostResponse = <Output>(
  schema: z.ZodType<Output>,
  payload: McpToolPayload,
  command: string,
): Output => {
  const parsed = schema.safeParse(payload);
  if (parsed.success) {
    return parsed.data;
  }

  throw new OdtToolError({
    code: "ODT_HOST_RESPONSE_INVALID",
    message: `Invalid response from host ${command}: ${parsed.error.message}`,
    details: { command },
    issues: toIssueDetails(parsed.error),
  });
};

function parseToolResponse<Name extends OdtToolName>(
  command: Name,
  payload: McpToolPayload,
): ToolOutput<Name>;
function parseToolResponse(command: OdtToolName, payload: McpToolPayload) {
  return parseHostResponse<ToolOutput<OdtToolName>>(
    ODT_HOST_BRIDGE_RESPONSE_SCHEMAS[command],
    payload,
    command,
  );
}

const createBridgeHttpError = async (response: Response, action: string): Promise<OdtToolError> => {
  try {
    const body = await response.json();
    const parsedPayload = odtToolErrorPayloadSchema.safeParse(body);
    if (parsedPayload.success) {
      const { code, message, details, issues } = parsedPayload.data.error;
      return new OdtToolError({ code, message, details, issues });
    }
  } catch {
    // Non-JSON bridge failures are normalized below with HTTP context.
  }

  return new OdtToolError({
    code: "ODT_HOST_BRIDGE_ERROR",
    message: `${action} failed with HTTP ${response.status} ${response.statusText}`,
    details: {
      action,
      status: response.status,
      statusText: response.statusText,
    },
  });
};

const createBridgeTransportError = (action: string, cause: unknown): OdtToolError => {
  return new OdtToolError(
    {
      code: "ODT_HOST_BRIDGE_ERROR",
      message: `${action} failed: ${toCauseMessage(cause)}`,
      details: { action },
    },
    { cause },
  );
};

const createBridgeJsonError = (action: string, cause: unknown): OdtToolError => {
  return new OdtToolError(
    {
      code: "ODT_HOST_RESPONSE_INVALID",
      message: `Invalid JSON response from ${action}: ${toCauseMessage(cause)}`,
      details: { action },
    },
    { cause },
  );
};

const assertToolCoverage = (ready: OdtHostBridgeReady): void => {
  const missing = Object.keys(ODT_TOOL_SCHEMAS).filter(
    (toolName) => !ready.toolNames.includes(toolName),
  );
  if (missing.length > 0) {
    throw new OdtToolError({
      code: "ODT_HOST_RESPONSE_INVALID",
      message: `OpenDucktor host bridge is missing required MCP tools: ${missing.join(", ")}`,
      details: { missingToolNames: missing },
    });
  }
};

export class OdtHostBridgeClient implements OdtHostBridgeClientPort {
  private readonly baseUrl: string;
  private readonly appToken: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OdtHostBridgeClientOptions, deps: OdtHostBridgeClientDeps = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.appToken = options.appToken;
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  async ready(): Promise<OdtHostBridgeReady> {
    const ready = await this.invokeJson(READY_TOOL_NAME, {});
    assertToolCoverage(ready);
    return ready;
  }

  async getWorkspaces(): Promise<GetWorkspacesResult> {
    return this.invokeJson("odt_get_workspaces", {});
  }

  async call<Name extends WorkspaceTaskToolName>(
    toolName: Name,
    workspaceId: string,
    input: ToolInput<Name>,
    caller?: OdtBrowserCaller,
  ): Promise<ToolOutput<Name>> {
    const body: OdtToolInput = {
      ...input,
      workspaceId,
    };
    if (caller) {
      body.caller = caller;
    }
    return this.invokeJson(toolName, body);
  }

  async callBrowserTool<Name extends OdtBrowserToolName>(
    toolName: Name,
    workspaceId: string,
    input: ToolInput<Name>,
    caller: OdtBrowserCaller,
  ): Promise<OdtBrowserToolResult> {
    const body: BrowserBridgeBody = { ...input, workspaceId, caller };
    return this.invokeJson(toolName, body, ODT_BROWSER_BRIDGE_TIMEOUT_MS);
  }

  private async invokeJson(
    command: typeof READY_TOOL_NAME,
    input: Record<string, never>,
  ): Promise<OdtHostBridgeReady>;
  private async invokeJson<Name extends OdtBrowserToolName>(
    command: Name,
    input: BrowserBridgeBody,
    timeoutMs: number,
  ): Promise<OdtBrowserToolResult>;
  private async invokeJson<Name extends OdtToolName>(
    command: Name,
    input: OdtToolInput,
  ): Promise<ToolOutput<Name>>;
  private async invokeJson(
    command: typeof READY_TOOL_NAME | OdtToolName,
    input: Record<string, never> | OdtToolInput | BrowserBridgeBody,
    timeoutMs = command === "odt_read_task_artifacts"
      ? ARTIFACT_READ_TIMEOUT_MS
      : DEFAULT_TIMEOUT_MS,
  ): Promise<OdtHostBridgeReady | ToolOutput<OdtToolName>> {
    const url = new URL(`/invoke/${command}`, this.baseUrl);
    const action = `host ${command}`;
    const headers: BridgeRequestHeaders = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (this.appToken) {
      headers["x-openducktor-app-token"] = this.appToken;
    }
    const response = await this.fetchBridge(
      url.toString(),
      {
        method: "POST",
        headers,
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(timeoutMs),
      },
      action,
    );

    if (!response.ok) {
      throw await createBridgeHttpError(response, action);
    }

    if (command === READY_TOOL_NAME) {
      return this.readReadyResponse(response, action);
    }
    return this.readToolResponse(response, action, command);
  }

  private async fetchBridge(input: string, init: RequestInit, action: string): Promise<Response> {
    try {
      return await this.fetchImpl(input, init);
    } catch (error) {
      throw createBridgeTransportError(action, error);
    }
  }

  private async readResponsePayload(response: Response, action: string): Promise<McpToolPayload> {
    try {
      return mcpToolPayloadSchema.parse(await response.json());
    } catch (error) {
      throw createBridgeJsonError(action, error);
    }
  }

  private async readReadyResponse(response: Response, action: string): Promise<OdtHostBridgeReady> {
    const payload = await this.readResponsePayload(response, action);
    const ready = odtHostBridgeReadySchema.safeParse(payload);
    if (!ready.success) {
      throw new OdtToolError({
        code: "ODT_HOST_RESPONSE_INVALID",
        message:
          "The OpenDucktor host bridge is incompatible. Update the host and MCP client together to bridge version 2.",
        details: { command: READY_TOOL_NAME },
        issues: toIssueDetails(ready.error),
      });
    }
    return ready.data;
  }

  private async readToolResponse<Name extends OdtToolName>(
    response: Response,
    action: string,
    command: Name,
  ): Promise<ToolOutput<Name>> {
    const payload = await this.readResponsePayload(response, action);
    return parseToolResponse(command, payload);
  }
}
