import {
  type GetWorkspacesResult,
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_TOOL_SCHEMAS,
  type OdtHostBridgeReady,
  type OdtToolName,
  odtHostBridgeReadySchema,
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

const toBridgeErrorMessage = async (response: Response, action: string): Promise<string> => {
  const fallback = `${action} failed with HTTP ${response.status} ${response.statusText}`;
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim().length > 0) {
      return body.error;
    }
    return fallback;
  } catch {
    return fallback;
  }
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
): z.infer<Schema> => {
  const parsed = schema.safeParse(payload);
  if (parsed.success) {
    return parsed.data;
  }

  throw new OdtToolError(
    "ODT_HOST_RESPONSE_INVALID",
    `Invalid response from host ${command}: ${parsed.error.message}`,
    { command, issues: toIssueDetails(parsed.error) },
  );
};

const createBridgeHttpError = async (response: Response, action: string): Promise<OdtToolError> => {
  return new OdtToolError("ODT_HOST_BRIDGE_ERROR", await toBridgeErrorMessage(response, action), {
    action,
    status: response.status,
    statusText: response.statusText,
  });
};

const assertToolCoverage = (ready: OdtHostBridgeReady): void => {
  const missing = Object.keys(ODT_TOOL_SCHEMAS).filter(
    (toolName) => !ready.toolNames.includes(toolName),
  );
  if (missing.length > 0) {
    throw new OdtToolError(
      "ODT_HOST_RESPONSE_INVALID",
      `Rust host bridge is missing required MCP tools: ${missing.join(", ")}`,
      { missingToolNames: missing },
    );
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
    await this.checkHealth();
    const payload = await this.invokeJson(READY_TOOL_NAME, {});
    const ready = parseHostResponse(odtHostBridgeReadySchema, payload, READY_TOOL_NAME);
    assertToolCoverage(ready);
    return ready;
  }

  async getWorkspaces(): Promise<GetWorkspacesResult> {
    const payload = await this.invokeJson("odt_get_workspaces", {});
    return parseHostResponse(
      ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_get_workspaces,
      payload,
      "odt_get_workspaces",
    );
  }

  async call<Name extends WorkspaceScopedToolName>(
    toolName: Name,
    workspaceId: string,
    input: ToolInput<Name>,
  ): Promise<ToolOutput<Name>> {
    const payload = await this.invokeJson(toolName, {
      ...input,
      workspaceId,
    });
    return parseHostResponse(
      ODT_HOST_BRIDGE_RESPONSE_SCHEMAS[toolName],
      payload,
      toolName,
    ) as ToolOutput<Name>;
  }

  private async checkHealth(): Promise<void> {
    const url = new URL("/health", this.baseUrl);
    const response = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw await createBridgeHttpError(response, "host health check");
    }
  }

  private async invokeJson(command: string, input: Record<string, unknown>): Promise<unknown> {
    const url = new URL(`/invoke/${command}`, this.baseUrl);
    const response = await this.fetchImpl(url.toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(this.appToken ? { "x-openducktor-app-token": this.appToken } : {}),
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw await createBridgeHttpError(response, `host ${command}`);
    }

    return response.json();
  }
}
