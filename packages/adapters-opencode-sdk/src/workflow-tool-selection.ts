import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { RuntimeDescriptor } from "@openducktor/contracts";
import { type AgentRole, buildRoleScopedOdtToolSelection } from "@openducktor/core";
import { unwrapData } from "./data-utils";
import { asUnknownRecord, readStringProp } from "./guards";
import { toToolIdList } from "./payload-mappers";

const TRUSTED_ODT_MCP_SERVER_NAME = "openducktor";
const CONNECTED_MCP_SERVER_STATUSES = new Set(["connected"]);

type ModelScopedToolInput = {
  providerId: string;
  modelId: string;
};

const isReadOnlyRole = (role: AgentRole): boolean =>
  role === "spec" || role === "planner" || role === "qa";

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

const toModelScopedToolIds = (payload: unknown): string[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  const toolIds: string[] = [];
  for (const entry of payload) {
    const toolId = readStringProp(entry, ["id"]);
    if (!toolId) {
      continue;
    }
    const trimmedToolId = toolId.trim();
    if (trimmedToolId.length === 0 || trimmedToolId === "invalid") {
      continue;
    }
    toolIds.push(trimmedToolId);
  }

  return toolIds;
};

const listModelScopedToolIds = async (input: {
  client: OpencodeClient;
  workingDirectory: string;
  model?: ModelScopedToolInput;
}): Promise<string[]> => {
  const providerId = input.model?.providerId.trim();
  const modelId = input.model?.modelId.trim();
  if (!providerId || !modelId) {
    return [];
  }

  const toolApi = (input.client as { tool?: { list?: unknown } }).tool;
  if (!toolApi || typeof toolApi.list !== "function") {
    return [];
  }

  const response = await (
    toolApi.list as (args: {
      directory: string;
      provider: string;
      model: string;
    }) => Promise<unknown>
  )({
    directory: input.workingDirectory,
    provider: providerId,
    model: modelId,
  });

  return toModelScopedToolIds(
    unwrapData(
      response as { data?: unknown; error?: { message?: string } | unknown },
      "list model-scoped tool ids for role policy",
    ),
  );
};

export const resolveWorkflowToolSelection = async (input: {
  client: OpencodeClient;
  role: AgentRole;
  runtimeDescriptor: RuntimeDescriptor;
  workingDirectory: string;
  model?: ModelScopedToolInput;
}): Promise<Record<string, boolean>> => {
  await assertTrustedOdtMcpServerConnected({
    client: input.client,
    workingDirectory: input.workingDirectory,
  });

  const response = await input.client.tool.ids({
    directory: input.workingDirectory,
  });
  const runtimeToolIdsFromDiscovery = toToolIdList(
    unwrapData(response, "list global tool ids for role policy"),
  );
  const runtimeToolIdsFromModelScope = await listModelScopedToolIds({
    client: input.client,
    workingDirectory: input.workingDirectory,
    ...(input.model ? { model: input.model } : {}),
  });
  const runtimeToolIds = Array.from(
    new Set([...runtimeToolIdsFromDiscovery, ...runtimeToolIdsFromModelScope]),
  );

  const selection = buildRoleScopedOdtToolSelection(input.role, {
    includeCanonicalDefaults: true,
    runtimeToolIds,
  });

  if (isReadOnlyRole(input.role)) {
    for (const toolId of input.runtimeDescriptor.readOnlyRoleBlockedTools) {
      selection[toolId] = false;
    }
  }

  return selection;
};
