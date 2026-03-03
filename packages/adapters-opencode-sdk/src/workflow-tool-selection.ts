import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import {
  AGENT_ROLE_TOOL_POLICY,
  type AgentRole,
  type AgentToolName,
  buildRoleScopedOdtToolSelection,
  resolveOdtWorkflowToolNameForAuthorization,
} from "@openducktor/core";
import { unwrapData } from "./data-utils";
import { asUnknownRecord, readStringProp } from "./guards";
import { toToolIdList } from "./payload-mappers";

const TRUSTED_ODT_MCP_SERVER_NAME = "openducktor";
const CONNECTED_MCP_SERVER_STATUSES = new Set(["connected"]);

const assertTrustedOdtMcpServerConnected = async (input: {
  client: OpencodeClient;
  workingDirectory: string;
}): Promise<void> => {
  const mcp = (input.client as { mcp?: { status?: unknown } }).mcp;
  if (!mcp || typeof mcp.status !== "function") {
    throw new Error(
      `ODT workflow tools unavailable: OpenCode MCP status API is unavailable for "${TRUSTED_ODT_MCP_SERVER_NAME}".`,
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
      `ODT workflow tools unavailable: invalid MCP status payload while checking "${TRUSTED_ODT_MCP_SERVER_NAME}".`,
    );
  }

  const serverStatus = statusRecord[TRUSTED_ODT_MCP_SERVER_NAME];
  const status = readStringProp(serverStatus, ["status"]);
  if (!status) {
    throw new Error(
      `ODT workflow tools unavailable: MCP server "${TRUSTED_ODT_MCP_SERVER_NAME}" status is missing.`,
    );
  }
  const normalizedStatus = status.trim().toLowerCase();
  if (CONNECTED_MCP_SERVER_STATUSES.has(normalizedStatus)) {
    return;
  }

  const errorDetails = readStringProp(serverStatus, ["error"]);
  throw new Error(
    `ODT workflow tools unavailable: MCP server "${TRUSTED_ODT_MCP_SERVER_NAME}" is "${status.trim()}"${
      errorDetails ? ` (${errorDetails})` : ""
    }.`,
  );
};

export const resolveWorkflowToolSelection = async (input: {
  client: OpencodeClient;
  role: AgentRole;
  workingDirectory: string;
}): Promise<Record<string, boolean>> => {
  const response = await input.client.tool.ids({
    directory: input.workingDirectory,
  });
  const runtimeToolIds = toToolIdList(unwrapData(response, "list tool ids for role policy"));
  if (runtimeToolIds.length === 0) {
    throw new Error("ODT workflow tools unavailable: runtime tool ID list is empty.");
  }

  await assertTrustedOdtMcpServerConnected({
    client: input.client,
    workingDirectory: input.workingDirectory,
  });

  const discoveredTrustedTools = new Set<AgentToolName>();
  for (const runtimeToolId of runtimeToolIds) {
    const normalizedTool = resolveOdtWorkflowToolNameForAuthorization(runtimeToolId);
    if (normalizedTool) {
      discoveredTrustedTools.add(normalizedTool);
    }
  }
  const missingRequiredTools = AGENT_ROLE_TOOL_POLICY[input.role].filter(
    (tool) => !discoveredTrustedTools.has(tool),
  );
  if (missingRequiredTools.length > 0) {
    throw new Error(
      `ODT workflow tools unavailable: missing trusted runtime tool IDs for role "${input.role}": ${missingRequiredTools.join(
        ", ",
      )}.`,
    );
  }

  return buildRoleScopedOdtToolSelection(input.role, {
    includeCanonicalDefaults: false,
    runtimeToolIds,
  });
};
