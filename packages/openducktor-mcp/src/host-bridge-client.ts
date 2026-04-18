import {
  type GetWorkspacesResult,
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_TOOL_SCHEMAS,
  type OdtHostBridgeReady,
  type OdtToolName,
  odtHostBridgeReadySchema,
} from "@openducktor/contracts";
import type { z } from "zod";
import { normalizeBaseUrl } from "./path-utils";

type ToolInput<Name extends OdtToolName> = z.infer<(typeof ODT_TOOL_SCHEMAS)[Name]>;
type ToolOutput<Name extends OdtToolName> = z.infer<
  (typeof ODT_HOST_BRIDGE_RESPONSE_SCHEMAS)[Name]
>;
type WorkspaceScopedToolName = Exclude<OdtToolName, "get_workspaces">;

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

const assertToolCoverage = (ready: OdtHostBridgeReady): void => {
  const missing = Object.keys(ODT_TOOL_SCHEMAS).filter(
    (toolName) => !ready.toolNames.includes(toolName),
  );
  if (missing.length > 0) {
    throw new Error(`Rust host bridge is missing required MCP tools: ${missing.join(", ")}`);
  }
};

export class OdtHostBridgeClient implements OdtHostBridgeClientPort {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OdtHostBridgeClientOptions, deps: OdtHostBridgeClientDeps = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  async ready(): Promise<OdtHostBridgeReady> {
    await this.checkHealth();
    const payload = await this.invokeJson(READY_TOOL_NAME, {});
    const ready = odtHostBridgeReadySchema.parse(payload);
    assertToolCoverage(ready);
    return ready;
  }

  async getWorkspaces(): Promise<GetWorkspacesResult> {
    const payload = await this.invokeJson("get_workspaces", {});
    return ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.get_workspaces.parse(payload);
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
    return ODT_HOST_BRIDGE_RESPONSE_SCHEMAS[toolName].parse(payload) as ToolOutput<Name>;
  }

  private async checkHealth(): Promise<void> {
    const url = new URL("/health", this.baseUrl);
    const response = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(await toBridgeErrorMessage(response, "host health check"));
    }
  }

  private async invokeJson(command: string, input: Record<string, unknown>): Promise<unknown> {
    const url = new URL(`/invoke/${command}`, this.baseUrl);
    const response = await this.fetchImpl(url.toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(await toBridgeErrorMessage(response, `host ${command}`));
    }

    return response.json();
  }
}
