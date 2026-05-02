import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import {
  isOpencodeExposedOdtToolAlias,
  ODT_WORKFLOW_AGENT_BLOCKED_TOOL_NAMES,
  type RuntimeDescriptor,
  toOpencodeExposedOdtToolIds,
} from "@openducktor/contracts";
import { type AgentRole, buildRoleScopedOdtToolSelection } from "@openducktor/core";
import { unwrapData } from "./data-utils";
import { asUnknownRecord, readStringProp } from "./guards";
import { toToolIdList } from "./payload-mappers";
import { isReadOnlyRole } from "./read-only-roles";

const OPENDUCKTOR_MCP_SERVER_NAME = "openducktor";
const CONNECTED_MCP_STATUS = "connected";

const OPENCODE_EXPOSED_ODT_TOOL_IDS_BLOCKED_FOR_WORKFLOW_AGENTS = new Set<string>(
  ODT_WORKFLOW_AGENT_BLOCKED_TOOL_NAMES.flatMap(toOpencodeExposedOdtToolIds),
);

const isToolIdControlledByOdtWorkflowSelection = (toolId: string): boolean =>
  isOpencodeExposedOdtToolAlias(toolId) ||
  OPENCODE_EXPOSED_ODT_TOOL_IDS_BLOCKED_FOR_WORKFLOW_AGENTS.has(toolId);

const assertTrustedOdtMcpServerConnected = async (input: {
  client: OpencodeClient;
  workingDirectory: string;
}): Promise<void> => {
  const mcp = (input.client as { mcp?: { status?: unknown } }).mcp;
  if (!mcp || typeof mcp.status !== "function") {
    throw new Error(
      `ODT workflow tools unavailable: OpenCode MCP status API is unavailable for "${OPENDUCKTOR_MCP_SERVER_NAME}".`,
    );
  }

  const response = await (mcp.status as (args: { directory: string }) => Promise<unknown>)({
    directory: input.workingDirectory,
  });
  const statusPayload = unwrapData(
    response as { data?: unknown; error?: { message?: string } | unknown },
    "get mcp status for role policy",
  );
  const statusRecord = asUnknownRecord(statusPayload);
  if (!statusRecord) {
    throw new Error(
      `ODT workflow tools unavailable: invalid MCP status payload while checking "${OPENDUCKTOR_MCP_SERVER_NAME}".`,
    );
  }

  const serverStatus = statusRecord[OPENDUCKTOR_MCP_SERVER_NAME];
  const status = readStringProp(serverStatus, ["status"]);
  if (!status) {
    throw new Error(
      `ODT workflow tools unavailable: MCP server "${OPENDUCKTOR_MCP_SERVER_NAME}" status is missing.`,
    );
  }
  const normalizedStatus = status.trim().toLowerCase();
  if (normalizedStatus === CONNECTED_MCP_STATUS) {
    return;
  }

  const errorDetails = readStringProp(serverStatus, ["error"]);
  throw new Error(
    `ODT workflow tools unavailable: MCP server "${OPENDUCKTOR_MCP_SERVER_NAME}" is "${status.trim()}"${
      errorDetails ? ` (${errorDetails})` : ""
    }.`,
  );
};

export const resolveWorkflowToolSelection = async (input: {
  client: OpencodeClient;
  role: AgentRole;
  runtimeDescriptor: RuntimeDescriptor;
  workingDirectory: string;
}): Promise<Record<string, boolean>> => {
  await assertTrustedOdtMcpServerConnected({
    client: input.client,
    workingDirectory: input.workingDirectory,
  });

  const response = await input.client.tool.ids({
    directory: input.workingDirectory,
  });
  const runtimeToolIds = toToolIdList(unwrapData(response, "list global tool ids for role policy"));

  const selection = buildRoleScopedOdtToolSelection(input.role, {
    includeCanonicalDefaults: true,
    runtimeToolIds,
    workflowToolAliasesByCanonical: input.runtimeDescriptor.workflowToolAliasesByCanonical,
  });

  for (const toolId of OPENCODE_EXPOSED_ODT_TOOL_IDS_BLOCKED_FOR_WORKFLOW_AGENTS) {
    selection[toolId] = false;
  }

  if (isReadOnlyRole(input.role)) {
    for (const toolId of input.runtimeDescriptor.readOnlyRoleBlockedTools) {
      selection[toolId] = false;
    }
  }

  for (const toolId of runtimeToolIds) {
    const trimmedToolId = toolId.trim();
    if (trimmedToolId.length === 0) {
      continue;
    }
    if (!isToolIdControlledByOdtWorkflowSelection(trimmedToolId)) {
      continue;
    }
    if (selection[trimmedToolId] !== undefined) {
      continue;
    }
    selection[trimmedToolId] = false;
  }

  return selection;
};
