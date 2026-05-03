import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import {
  isOpencodeExposedOdtToolAlias,
  ODT_WORKFLOW_AGENT_BLOCKED_TOOL_NAMES,
  type RuntimeDescriptor,
  toOpencodeExposedOdtToolIds,
} from "@openducktor/contracts";
import {
  type AgentRole,
  buildRoleScopedOdtToolSelection,
  isReadOnlyAgentRole,
} from "@openducktor/core";
import { unwrapData } from "./data-utils";
import { asUnknownRecord, readStringProp } from "./guards";
import { toToolIdList } from "./payload-mappers";

const OPENDUCKTOR_MCP_SERVER_NAME = "openducktor";
const CONNECTED_MCP_STATUS = "connected";

const OPENCODE_EXPOSED_ODT_TOOL_IDS_BLOCKED_FOR_WORKFLOW_AGENTS = new Set<string>(
  ODT_WORKFLOW_AGENT_BLOCKED_TOOL_NAMES.flatMap(toOpencodeExposedOdtToolIds),
);

const isToolIdControlledByOdtWorkflowSelection = (toolId: string): boolean =>
  isOpencodeExposedOdtToolAlias(toolId) ||
  OPENCODE_EXPOSED_ODT_TOOL_IDS_BLOCKED_FOR_WORKFLOW_AGENTS.has(toolId);

type McpApi = {
  status?: (args: { directory: string }) => Promise<unknown>;
  connect?: (args: { directory: string; name: string }) => Promise<unknown>;
};

type OdtMcpStatus = {
  status: string;
  errorDetails: string | undefined;
};

const readOdtMcpStatus = async (input: {
  mcp: McpApi;
  workingDirectory: string;
}): Promise<OdtMcpStatus> => {
  if (typeof input.mcp.status !== "function") {
    throw new Error(
      `ODT workflow tools unavailable: OpenCode MCP status API is unavailable for "${OPENDUCKTOR_MCP_SERVER_NAME}".`,
    );
  }

  const response = await input.mcp.status({
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

  return {
    status,
    errorDetails: readStringProp(serverStatus, ["error"]),
  };
};

const formatOdtMcpUnavailableError = (input: {
  workingDirectory: string;
  status: string;
  errorDetails: string | undefined;
  recoveredStatus?: OdtMcpStatus;
}): string => {
  const initialStatus = input.status.trim();
  const initialDetails = input.errorDetails ? ` (${input.errorDetails})` : "";
  if (!input.recoveredStatus) {
    return `ODT workflow tools unavailable for "${input.workingDirectory}": MCP server "${OPENDUCKTOR_MCP_SERVER_NAME}" is "${initialStatus}"${initialDetails}.`;
  }

  const recoveredDetails = input.recoveredStatus.errorDetails
    ? ` (${input.recoveredStatus.errorDetails})`
    : "";
  return `ODT workflow tools unavailable for "${input.workingDirectory}": MCP server "${OPENDUCKTOR_MCP_SERVER_NAME}" stayed unavailable after reconnect. Initial status was "${initialStatus}"${initialDetails}; recovered status is "${input.recoveredStatus.status.trim()}"${recoveredDetails}.`;
};

export const ensureTrustedOdtMcpServerConnected = async (input: {
  client: OpencodeClient;
  workingDirectory: string;
  onReconnectStart?: (event: {
    serverName: string;
    workingDirectory: string;
    status: string;
    errorDetails: string | undefined;
  }) => void;
}): Promise<void> => {
  const mcp = (input.client as { mcp?: McpApi }).mcp;
  if (!mcp) {
    throw new Error(
      `ODT workflow tools unavailable: OpenCode MCP status API is unavailable for "${OPENDUCKTOR_MCP_SERVER_NAME}".`,
    );
  }

  const initialStatus = await readOdtMcpStatus({
    mcp,
    workingDirectory: input.workingDirectory,
  });
  const normalizedStatus = initialStatus.status.trim().toLowerCase();
  if (normalizedStatus === CONNECTED_MCP_STATUS) {
    return;
  }

  if (typeof mcp.connect !== "function") {
    throw new Error(
      formatOdtMcpUnavailableError({
        workingDirectory: input.workingDirectory,
        status: initialStatus.status,
        errorDetails: initialStatus.errorDetails,
      }),
    );
  }

  input.onReconnectStart?.({
    serverName: OPENDUCKTOR_MCP_SERVER_NAME,
    workingDirectory: input.workingDirectory,
    status: initialStatus.status,
    errorDetails: initialStatus.errorDetails,
  });

  const connectResponse = await mcp.connect({
    directory: input.workingDirectory,
    name: OPENDUCKTOR_MCP_SERVER_NAME,
  });
  unwrapData(
    connectResponse as { data?: unknown; error?: { message?: string } | unknown },
    `connect mcp server ${OPENDUCKTOR_MCP_SERVER_NAME} for role policy`,
  );

  const recoveredStatus = await readOdtMcpStatus({
    mcp,
    workingDirectory: input.workingDirectory,
  });
  if (recoveredStatus.status.trim().toLowerCase() === CONNECTED_MCP_STATUS) {
    return;
  }

  throw new Error(
    formatOdtMcpUnavailableError({
      workingDirectory: input.workingDirectory,
      status: initialStatus.status,
      errorDetails: initialStatus.errorDetails,
      recoveredStatus,
    }),
  );
};

export const resolveWorkflowToolSelection = async (input: {
  client: OpencodeClient;
  role: AgentRole;
  runtimeDescriptor: RuntimeDescriptor;
  workingDirectory: string;
  skipMcpConnectionCheck?: boolean;
  onReconnectStart?: (event: {
    serverName: string;
    workingDirectory: string;
    status: string;
    errorDetails: string | undefined;
  }) => void;
}): Promise<Record<string, boolean>> => {
  if (input.skipMcpConnectionCheck !== true) {
    await ensureTrustedOdtMcpServerConnected({
      client: input.client,
      workingDirectory: input.workingDirectory,
      ...(input.onReconnectStart ? { onReconnectStart: input.onReconnectStart } : {}),
    });
  }

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

  if (isReadOnlyAgentRole(input.role)) {
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
