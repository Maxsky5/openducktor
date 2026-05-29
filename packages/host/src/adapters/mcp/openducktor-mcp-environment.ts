import { ODT_WORKFLOW_AGENT_TOOL_NAMES } from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";

export const OPENDUCKTOR_MCP_ENV_VAR_NAMES = [
  "ODT_WORKSPACE_ID",
  "ODT_HOST_URL",
  "ODT_HOST_TOKEN",
  "ODT_FORBID_WORKSPACE_ID_INPUT",
  "ODT_ALLOWED_TOOLS",
] as const;

export type OpenDucktorMcpBridgeEnvironment = Record<
  (typeof OPENDUCKTOR_MCP_ENV_VAR_NAMES)[number],
  string
>;

export type OpenDucktorMcpBridgeConnection = {
  workspaceId: string;
  hostUrl: string;
  hostToken: string;
};

const requireBridgeValue = (
  value: string,
  label: keyof OpenDucktorMcpBridgeConnection,
  runtimeName: string,
): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new HostValidationError({
      message: `${runtimeName} MCP bridge ${label} is required.`,
      field: label,
    });
  }
  return trimmed;
};

export const buildOpenDucktorMcpBridgeEnvironment = (
  bridge: OpenDucktorMcpBridgeConnection,
  runtimeName: string,
): OpenDucktorMcpBridgeEnvironment => ({
  ODT_WORKSPACE_ID: requireBridgeValue(bridge.workspaceId, "workspaceId", runtimeName),
  ODT_HOST_URL: requireBridgeValue(bridge.hostUrl, "hostUrl", runtimeName),
  ODT_HOST_TOKEN: requireBridgeValue(bridge.hostToken, "hostToken", runtimeName),
  ODT_FORBID_WORKSPACE_ID_INPUT: "true",
  ODT_ALLOWED_TOOLS: ODT_WORKFLOW_AGENT_TOOL_NAMES.join(","),
});
