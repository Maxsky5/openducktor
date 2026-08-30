import {
  type GetWorkspacesResult,
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_TOOL_SCHEMAS,
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
type WorkspaceScopedToolName = WorkspaceScopedOdtToolName;
type OdtToolInput = ToolInput<OdtToolName>;
type BridgeRequestHeaders = {
  Accept: "application/json";
  "Content-Type": "application/json";
  "x-openducktor-app-token"?: string;
};

export type OdtHostBridgeClientPort = {
  ready(): Promise<OdtHostBridgeReady>;
  getWorkspaces(): Promise<GetWorkspacesResult>;
  call<Name extends WorkspaceScopedToolName>(
    toolName: Name,
    workspaceId: string,
    input: ToolInput<Name>,
  ): Promise<ToolOutput<Name>>;
};

export type OdtHostBridgeClientOptions = {
  baseUrl: string;
  appToken?: string | undefined;
};

export type OdtHostBridgeClientDeps = {
  fetchImpl?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 10_000;
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
  switch (command) {
    case "odt_get_workspaces":
      return parseHostResponse(
        ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_get_workspaces,
        payload,
        command,
      );
    case "odt_create_task":
      return parseHostResponse(ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_create_task, payload, command);
    case "odt_search_tasks":
      return parseHostResponse(ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_search_tasks, payload, command);
    case "odt_read_task":
      return parseHostResponse(ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_read_task, payload, command);
    case "odt_read_task_assets":
      return parseHostResponse(
        ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_read_task_assets,
        payload,
        command,
      );
    case "odt_read_task_documents":
      return parseHostResponse(
        ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_read_task_documents,
        payload,
        command,
      );
    case "odt_set_spec":
      return parseHostResponse(ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_set_spec, payload, command);
    case "odt_set_plan":
      return parseHostResponse(ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_set_plan, payload, command);
    case "odt_build_blocked":
      return parseHostResponse(
        ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_build_blocked,
        payload,
        command,
      );
    case "odt_build_resumed":
      return parseHostResponse(
        ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_build_resumed,
        payload,
        command,
      );
    case "odt_build_completed":
      return parseHostResponse(
        ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_build_completed,
        payload,
        command,
      );
    case "odt_set_pull_request":
      return parseHostResponse(
        ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_set_pull_request,
        payload,
        command,
      );
    case "odt_qa_approved":
      return parseHostResponse(ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_qa_approved, payload, command);
    case "odt_qa_rejected":
      return parseHostResponse(ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_qa_rejected, payload, command);
  }
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

  async call<Name extends WorkspaceScopedToolName>(
    toolName: Name,
    workspaceId: string,
    input: ToolInput<Name>,
  ): Promise<ToolOutput<Name>> {
    return this.invokeJson(toolName, {
      ...input,
      workspaceId,
    });
  }

  private async invokeJson(
    command: typeof READY_TOOL_NAME,
    input: Record<string, never>,
  ): Promise<OdtHostBridgeReady>;
  private async invokeJson<Name extends OdtToolName>(
    command: Name,
    input: OdtToolInput,
  ): Promise<ToolOutput<Name>>;
  private async invokeJson(
    command: typeof READY_TOOL_NAME | OdtToolName,
    input: Record<string, never> | OdtToolInput,
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
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
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
    return parseHostResponse(odtHostBridgeReadySchema, payload, READY_TOOL_NAME);
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
