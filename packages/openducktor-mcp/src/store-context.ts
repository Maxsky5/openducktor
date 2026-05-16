import { readFile } from "node:fs/promises";
import { OdtHostBridgeClient } from "./host-bridge-client";
import { normalizeOptionalInput, resolveMcpBridgeDiscoveryPath } from "./path-utils";

const FORBID_WORKSPACE_ID_INPUT_ENV = "ODT_FORBID_WORKSPACE_ID_INPUT";
const HOST_TOKEN_ENV = "ODT_HOST_TOKEN";

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
  beadsAttachmentDir?: string;
  doltHost?: string;
  doltPort?: string;
  databaseName?: string;
};

type DiscoveredHostConnection = {
  hostUrl: string;
  hostToken: string;
};

const rejectLegacyContract = (context: OdtStoreContext): void => {
  const legacyEntries = [
    [
      "ODT_BEADS_ATTACHMENT_DIR",
      normalizeOptionalInput(context.beadsAttachmentDir) ??
        normalizeOptionalInput(process.env.ODT_BEADS_ATTACHMENT_DIR),
    ],
    [
      "ODT_DOLT_HOST",
      normalizeOptionalInput(context.doltHost) ?? normalizeOptionalInput(process.env.ODT_DOLT_HOST),
    ],
    [
      "ODT_DOLT_PORT",
      normalizeOptionalInput(context.doltPort) ?? normalizeOptionalInput(process.env.ODT_DOLT_PORT),
    ],
    [
      "ODT_DATABASE_NAME",
      normalizeOptionalInput(context.databaseName) ??
        normalizeOptionalInput(process.env.ODT_DATABASE_NAME),
    ],
    ["ODT_METADATA_NAMESPACE", normalizeOptionalInput(process.env.ODT_METADATA_NAMESPACE)],
  ].filter(([, value]) => value !== undefined);

  if (legacyEntries.length === 0) {
    return;
  }

  throw new Error(
    `Direct Beads/Dolt MCP startup is no longer supported. Remove ${legacyEntries
      .map(([name]) => name)
      .join(
        ", ",
      )} and use the host bridge discovery path or ODT_HOST_URL instead. Metadata namespace is now owned by the OpenDucktor host.`,
  );
};

const validateExplicitHostUrl = async (hostUrl: string, hostToken?: string): Promise<string> => {
  try {
    new URL(hostUrl);
  } catch {
    throw new Error(`Invalid ODT_HOST_URL for OpenDucktor MCP: ${hostUrl}`);
  }

  await new OdtHostBridgeClient({ baseUrl: hostUrl, appToken: hostToken }).ready();
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
  hostUrl: string,
  workspaceId: string,
  hostToken?: string,
): Promise<void> => {
  const workspaces = await new OdtHostBridgeClient({
    baseUrl: hostUrl,
    appToken: hostToken,
  }).getWorkspaces();
  if (workspaces.workspaces.some((workspace) => workspace.workspaceId === workspaceId)) {
    return;
  }

  throw new Error(
    `Configured default workspace '${workspaceId}' was not found on the running OpenDucktor host. Start @openducktor/mcp with a valid --workspace-id or omit it and provide workspaceId per tool call.`,
  );
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
  if (typeof parsed.hostUrl !== "string" || normalizeOptionalInput(parsed.hostUrl) === undefined) {
    throw new Error(
      `Invalid OpenDucktor MCP discovery file at ${discoveryPath}: hostUrl must be a non-empty string.`,
    );
  }
  if (
    typeof parsed.hostToken !== "string" ||
    normalizeOptionalInput(parsed.hostToken) === undefined
  ) {
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
    hostToken: parsed.hostToken,
    hostUrl: parsed.hostUrl,
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
  try {
    await new OdtHostBridgeClient({
      baseUrl: discovered.hostUrl,
      appToken: candidateHostToken,
    }).ready();
    if (workspaceId) {
      await validateConfiguredWorkspace(discovered.hostUrl, workspaceId, candidateHostToken);
    }
    return {
      hostToken: candidateHostToken,
      hostUrl: discovered.hostUrl,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No healthy OpenDucktor host was discovered. Checked ${discoveryPath}. ${discovered.hostUrl}: ${reason} Provide ODT_HOST_URL to override discovery.`,
    );
  }
};

export const resolveStoreContext = async (context: OdtStoreContext): Promise<OdtStoreOptions> => {
  rejectLegacyContract(context);

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
    hostUrl = await validateExplicitHostUrl(explicitHostUrl, resolvedHostToken);
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

  if (explicitHostUrl) {
    await validateConfiguredWorkspace(hostUrl, workspaceId, resolvedHostToken);
  }

  return {
    workspaceId,
    hostUrl,
    ...(resolvedHostToken ? { hostToken: resolvedHostToken } : {}),
    ...workspaceIdInputMode,
  };
};
