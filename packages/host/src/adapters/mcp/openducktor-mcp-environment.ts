import {
  ODT_MCP_TOOL_NAMES,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeKind,
} from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";

export const OPENDUCKTOR_MCP_ENV_VAR_NAMES = [
  "ODT_WORKSPACE_ID",
  "ODT_HOST_URL",
  "ODT_HOST_TOKEN",
  "ODT_FORBID_WORKSPACE_ID_INPUT",
  "ODT_ALLOWED_TOOLS",
  "ODT_RUNTIME_KIND",
] as const;

/**
 * The Claude session that owns an OpenDucktor MCP process. Claude starts one MCP process for
 * each session and sends no session ID with a tool call, so browser tools read it here.
 */
export const OPENDUCKTOR_MCP_RUNTIME_SESSION_ID_ENV = "ODT_RUNTIME_SESSION_ID";

export type OpenDucktorMcpBridgeEnvironment = Record<
  (typeof OPENDUCKTOR_MCP_ENV_VAR_NAMES)[number],
  string
>;

/**
 * Removes the workspace binding of the OpenDucktor MCP server from a shared runtime process.
 * One shared runtime serves every workspace, so each session receives its own binding.
 */
export const withoutOpenDucktorMcpEnvironment = (
  processEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv => {
  const env = { ...processEnv };
  for (const name of OPENDUCKTOR_MCP_ENV_VAR_NAMES) {
    delete env[name];
  }
  delete env[OPENDUCKTOR_MCP_RUNTIME_SESSION_ID_ENV];
  return env;
};

export type OpenDucktorMcpBridgeConnection = {
  workspaceId: string;
  hostUrl: string;
  hostToken: string;
};

const requireBridgeValue = (
  value: string,
  label: keyof OpenDucktorMcpBridgeConnection,
  runtimeKind: RuntimeKind,
): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new HostValidationError({
      message: `${RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind].label} MCP bridge ${label} is required.`,
      field: label,
    });
  }
  return trimmed;
};

/** `ODT_RUNTIME_KIND` tells browser tools where the calling session ID comes from. */
export const buildOpenDucktorMcpBridgeEnvironment = (
  bridge: OpenDucktorMcpBridgeConnection,
  runtimeKind: RuntimeKind,
) =>
  ({
    ODT_WORKSPACE_ID: requireBridgeValue(bridge.workspaceId, "workspaceId", runtimeKind),
    ODT_HOST_URL: requireBridgeValue(bridge.hostUrl, "hostUrl", runtimeKind),
    ODT_HOST_TOKEN: requireBridgeValue(bridge.hostToken, "hostToken", runtimeKind),
    ODT_FORBID_WORKSPACE_ID_INPUT: "true",
    ODT_ALLOWED_TOOLS: ODT_MCP_TOOL_NAMES.join(","),
    ODT_RUNTIME_KIND: runtimeKind,
  }) satisfies OpenDucktorMcpBridgeEnvironment;
