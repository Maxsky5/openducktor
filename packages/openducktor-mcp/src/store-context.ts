import { readFile } from "node:fs/promises";
import { OdtHostBridgeClient } from "./host-bridge-client";
import { normalizeOptionalInput, resolveMcpBridgeRegistryPath } from "./path-utils";

export type OdtStoreOptions = {
  workspaceId: string;
  hostUrl: string;
};

export type OdtStoreContext = {
  workspaceId?: string;
  hostUrl?: string;
  beadsAttachmentDir?: string;
  doltHost?: string;
  doltPort?: string;
  databaseName?: string;
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
      )} and use the host bridge discovery path or ODT_HOST_URL instead. Metadata namespace is now owned by the Rust host.`,
  );
};

const validateExplicitHostUrl = async (hostUrl: string, workspaceId: string): Promise<string> => {
  try {
    new URL(hostUrl);
  } catch {
    throw new Error(`Invalid ODT_HOST_URL for OpenDucktor MCP: ${hostUrl}`);
  }

  await new OdtHostBridgeClient({ baseUrl: hostUrl, workspaceId }).ready();
  return hostUrl;
};

const parseDiscoveredPorts = (payload: string, registryPath: string): number[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed parsing the OpenDucktor MCP discovery registry at ${registryPath}: ${reason}`,
    );
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { ports?: unknown }).ports)
  ) {
    throw new Error(
      `Invalid OpenDucktor MCP discovery registry at ${registryPath}: expected a JSON object with a ports array.`,
    );
  }

  const ports = (parsed as { ports: unknown[] }).ports.map((port) => {
    if (!Number.isInteger(port)) {
      throw new Error(
        `Invalid OpenDucktor MCP discovery registry at ${registryPath}: ports must be integers between 1 and 65535.`,
      );
    }

    const numericPort = port as number;
    if (numericPort < 1 || numericPort > 65535) {
      throw new Error(
        `Invalid OpenDucktor MCP discovery registry at ${registryPath}: ports must be integers between 1 and 65535.`,
      );
    }
    return numericPort;
  });

  const discoveredPorts: number[] = [];
  const seen = new Set<number>();
  for (const port of ports) {
    if (seen.has(port)) {
      continue;
    }
    seen.add(port);
    discoveredPorts.push(port);
  }

  return discoveredPorts;
};

const discoverHostUrl = async (workspaceId: string): Promise<string> => {
  const registryPath = resolveMcpBridgeRegistryPath();

  let registryPayload: string;
  try {
    registryPayload = await readFile(registryPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(
        `No running OpenDucktor host was discovered. Checked ${registryPath}. Start the OpenDucktor desktop app or provide ODT_HOST_URL to override discovery.`,
      );
    }

    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed reading the OpenDucktor MCP discovery registry at ${registryPath}: ${reason}`,
    );
  }

  const discoveredPorts = parseDiscoveredPorts(registryPayload, registryPath);
  if (discoveredPorts.length === 0) {
    throw new Error(
      `No running OpenDucktor host was discovered. ${registryPath} does not contain any bridge ports. Start the OpenDucktor desktop app or provide ODT_HOST_URL to override discovery.`,
    );
  }

  const failures: string[] = [];
  for (const port of discoveredPorts) {
    const hostUrl = `http://127.0.0.1:${port}`;
    try {
      await new OdtHostBridgeClient({ baseUrl: hostUrl, workspaceId }).ready();
      return hostUrl;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${hostUrl}: ${reason}`);
    }
  }

  throw new Error(
    `No healthy OpenDucktor host was discovered for workspace ${workspaceId}. Checked ${registryPath}. ${failures.join(" | ")} Provide ODT_HOST_URL to override discovery.`,
  );
};

export const resolveStoreContext = async (context: OdtStoreContext): Promise<OdtStoreOptions> => {
  rejectLegacyContract(context);

  const workspaceId =
    normalizeOptionalInput(context.workspaceId) ??
    normalizeOptionalInput(process.env.ODT_WORKSPACE_ID);
  if (!workspaceId) {
    throw new Error("Missing workspace ID for OpenDucktor MCP.");
  }

  const explicitHostUrl =
    normalizeOptionalInput(context.hostUrl) ?? normalizeOptionalInput(process.env.ODT_HOST_URL);
  const hostUrl = explicitHostUrl
    ? await validateExplicitHostUrl(explicitHostUrl, workspaceId)
    : await discoverHostUrl(workspaceId);

  const resolved = {
    workspaceId,
    hostUrl,
  };

  return resolved;
};
