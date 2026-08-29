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
import type { z } from "zod";
import { normalizeBaseUrl } from "./path-utils";
import { OdtToolError } from "./tool-results";

type ToolInput<Name extends OdtToolName> = z.infer<(typeof ODT_TOOL_SCHEMAS)[Name]>;
type ToolOutput<Name extends OdtToolName> = z.infer<
  (typeof ODT_HOST_BRIDGE_RESPONSE_SCHEMAS)[Name]
>;
type WorkspaceScopedToolName = WorkspaceScopedOdtToolName;

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

const toCauseMessage = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }
  if (typeof cause === "string" && cause.trim().length > 0) {
    return cause.trim();
  }
  if (typeof cause === "number" || typeof cause === "boolean") {
    return String(cause);
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
    path: issue.path.filter((entry): entry is string | number => {
      return typeof entry === "string" || typeof entry === "number";
    }),
    message: issue.message,
    code: issue.code,
  }));
};

const parseHostResponse = <Schema extends z.ZodType>(
  schema: Schema,
  payload: unknown,
  command: string,
): z.output<Schema> => {
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
  return new OdtToolError({
    code: "ODT_HOST_BRIDGE_ERROR",
    message: `${action} failed: ${toCauseMessage(cause)}`,
    details: {
      action,
      causeName: cause instanceof Error ? cause.name : Object.prototype.toString.call(cause),
    },
  });
};

const createBridgeJsonError = (action: string, cause: unknown): OdtToolError => {
  return new OdtToolError({
    code: "ODT_HOST_RESPONSE_INVALID",
    message: `Invalid JSON response from ${action}: ${toCauseMessage(cause)}`,
    details: {
      action,
      causeName: cause instanceof Error ? cause.name : Object.prototype.toString.call(cause),
    },
  });
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
    input: Record<string, unknown>,
  ): Promise<OdtHostBridgeReady>;
  private async invokeJson<Name extends OdtToolName>(
    command: Name,
    input: Record<string, unknown>,
  ): Promise<ToolOutput<Name>>;
  private async invokeJson(
    command: typeof READY_TOOL_NAME | OdtToolName,
    input: Record<string, unknown>,
  ): Promise<OdtHostBridgeReady | ToolOutput<OdtToolName>> {
    const url = new URL(`/invoke/${command}`, this.baseUrl);
    const action = `host ${command}`;
    const response = await this.fetchBridge(
      url.toString(),
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(this.appToken ? { "x-openducktor-app-token": this.appToken } : undefined),
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      },
      action,
    );

    if (!response.ok) {
      throw await createBridgeHttpError(response, action);
    }

    return this.readJsonResponse(response, action, command);
  }

  private async fetchBridge(input: string, init: RequestInit, action: string): Promise<Response> {
    try {
      return await this.fetchImpl(input, init);
    } catch (error) {
      throw createBridgeTransportError(action, error);
    }
  }

  private async readJsonResponse(
    response: Response,
    action: string,
    command: typeof READY_TOOL_NAME | OdtToolName,
  ): Promise<OdtHostBridgeReady | ToolOutput<OdtToolName>> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw createBridgeJsonError(action, error);
    }
    if (command === READY_TOOL_NAME) {
      return parseHostResponse(odtHostBridgeReadySchema, payload, command);
    }
    return parseHostResponse(ODT_HOST_BRIDGE_RESPONSE_SCHEMAS[command], payload, command);
  }
}
