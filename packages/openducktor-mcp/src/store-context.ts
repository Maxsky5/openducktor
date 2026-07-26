import { readFile } from "node:fs/promises";
import { OdtHostBridgeClient } from "./host-bridge-client";
import { normalizeOptionalInput, resolveMcpBridgeDiscoveryPath } from "./path-utils";

const FORBID_WORKSPACE_ID_INPUT_ENV = "ODT_FORBID_WORKSPACE_ID_INPUT";
const HOST_TOKEN_ENV = "ODT_HOST_TOKEN";

class ConfiguredWorkspaceNotFoundError extends Error {}

export type OdtStoreOptions = {
  workspaceId?: string;
  hostUrl: string;
  hostToken?: string;
  forbidWorkspaceIdInput?: boolean;
};

export type OdtStoreContext = {
  workspaceId?: string;
  hostUrl?: string;
  hostToken?: string;
  forbidWorkspaceIdInput?: boolean;
};

type DiscoveredHostConnection = {
  hostUrl: string;
  hostToken: string;
};

const validateExplicitHostUrl = async (
  hostUrl: string,
  workspaceId?: string,
  hostToken?: string,
): Promise<string> => {
  try {
    new URL(hostUrl);
  } catch {
    throw new Error(`Invalid ODT_HOST_URL for OpenDucktor MCP: ${hostUrl}`);
  }

  const client = new OdtHostBridgeClient({ baseUrl: hostUrl, appToken: hostToken });
  await validateHostConnection(client, workspaceId);
  return hostUrl;
};

const readBooleanEnv = (name: string): boolean | undefined => {
  const value = normalizeOptionalInput(process.env[name]);
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  throw new Error(`${name} must be true, false, 1, or 0.`);
};

const validateConfiguredWorkspace = async (
  client: OdtHostBridgeClient,
  workspaceId: string,
): Promise<void> => {
  const workspaces = await client.getWorkspaces();
  if (workspaces.workspaces.some((workspace) => workspace.workspaceId === workspaceId)) {
    return;
  }

  throw new ConfiguredWorkspaceNotFoundError(
    `Configured default workspace '${workspaceId}' was not found on the running OpenDucktor host. Start @openducktor/mcp with a valid --workspace-id or omit it and provide workspaceId per tool call.`,
  );
};

const validateHostConnection = async (
  client: OdtHostBridgeClient,
  workspaceId?: string,
): Promise<void> => {
  if (!workspaceId) {
    await client.ready();
    return;
  }

  const [readinessResult, workspaceResult] = await Promise.allSettled([
    client.ready(),
    validateConfiguredWorkspace(client, workspaceId),
  ]);
  if (readinessResult.status === "rejected") {
    throw readinessResult.reason;
  }
  if (workspaceResult.status === "rejected") {
    throw workspaceResult.reason;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const parseDiscoveryFile = (payload: string, discoveryPath: string): DiscoveredHostConnection => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed parsing the OpenDucktor MCP discovery file at ${discoveryPath}: ${reason}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(
      `Invalid OpenDucktor MCP discovery file at ${discoveryPath}: expected a JSON object.`,
    );
  }
  const hostUrl =
    typeof parsed.hostUrl === "string" ? normalizeOptionalInput(parsed.hostUrl) : undefined;
  const hostToken =
    typeof parsed.hostToken === "string" ? normalizeOptionalInput(parsed.hostToken) : undefined;

  if (hostUrl === undefined) {
    throw new Error(
      `Invalid OpenDucktor MCP discovery file at ${discoveryPath}: hostUrl must be a non-empty string.`,
    );
  }
  if (hostToken === undefined) {
    throw new Error(
      `Invalid OpenDucktor MCP discovery file at ${discoveryPath}: hostToken must be a non-empty string.`,
    );
  }
  const pid = parsed.pid;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    throw new Error(
      `Invalid OpenDucktor MCP discovery file at ${discoveryPath}: pid must be a positive integer.`,
    );
  }

  return {
    hostToken,
    hostUrl,
  };
};

const discoverHostConnection = async (
  workspaceId?: string,
  hostToken?: string,
): Promise<DiscoveredHostConnection> => {
  const discoveryPath = resolveMcpBridgeDiscoveryPath();

  let discoveryPayload: string;
  try {
    discoveryPayload = await readFile(discoveryPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(
        `No running OpenDucktor host was discovered. Checked ${discoveryPath}. Start the OpenDucktor desktop app or provide ODT_HOST_URL to override discovery.`,
      );
    }

    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed reading the OpenDucktor MCP discovery file at ${discoveryPath}: ${reason}`,
    );
  }

  const discovered = parseDiscoveryFile(discoveryPayload, discoveryPath);
  const candidateHostToken = hostToken ?? discovered.hostToken;
  const client = new OdtHostBridgeClient({
    baseUrl: discovered.hostUrl,
    appToken: candidateHostToken,
  });
  try {
    await validateHostConnection(client, workspaceId);
    return {
      hostToken: candidateHostToken,
      hostUrl: discovered.hostUrl,
    };
  } catch (error) {
    if (error instanceof ConfiguredWorkspaceNotFoundError) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No healthy OpenDucktor host was discovered. Checked ${discoveryPath}. ${discovered.hostUrl}: ${reason} Provide ODT_HOST_URL to override discovery.`,
    );
  }
};

export const resolveStoreContext = async (context: OdtStoreContext): Promise<OdtStoreOptions> => {
  const workspaceId =
    normalizeOptionalInput(context.workspaceId) ??
    normalizeOptionalInput(process.env.ODT_WORKSPACE_ID);
  const forbidWorkspaceIdInput =
    context.forbidWorkspaceIdInput ?? readBooleanEnv(FORBID_WORKSPACE_ID_INPUT_ENV);

  const explicitHostUrl =
    normalizeOptionalInput(context.hostUrl) ?? normalizeOptionalInput(process.env.ODT_HOST_URL);
  let resolvedHostToken =
    normalizeOptionalInput(context.hostToken) ??
    normalizeOptionalInput(process.env[HOST_TOKEN_ENV]);
  let hostUrl: string;
  if (explicitHostUrl) {
    hostUrl = await validateExplicitHostUrl(explicitHostUrl, workspaceId, resolvedHostToken);
  } else {
    const discovered = await discoverHostConnection(workspaceId, resolvedHostToken);
    hostUrl = discovered.hostUrl;
    resolvedHostToken = discovered.hostToken;
  }
  const workspaceIdInputMode =
    forbidWorkspaceIdInput !== undefined ? { forbidWorkspaceIdInput } : {};

  if (!workspaceId) {
    return {
      hostUrl,
      ...(resolvedHostToken ? { hostToken: resolvedHostToken } : {}),
      ...workspaceIdInputMode,
    };
  }

  return {
    workspaceId,
    hostUrl,
    ...(resolvedHostToken ? { hostToken: resolvedHostToken } : {}),
    ...workspaceIdInputMode,
  };
};
