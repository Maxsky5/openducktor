import { OdtHostBridgeClient } from "./host-bridge-client";
import { normalizeOptionalInput, resolveCanonicalPath } from "./path-utils";

export type OdtStoreOptions = {
  repoPath: string;
  hostUrl: string;
  metadataNamespace: string;
};

export type OdtStoreContext = {
  repoPath?: string;
  hostUrl?: string;
  beadsAttachmentDir?: string;
  doltHost?: string;
  doltPort?: string;
  databaseName?: string;
  metadataNamespace?: string;
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
  ].filter(([, value]) => value !== undefined);

  if (legacyEntries.length === 0) {
    return;
  }

  throw new Error(
    `Direct Beads/Dolt MCP startup is no longer supported. Remove ${legacyEntries
      .map(([name]) => name)
      .join(", ")} and provide ODT_HOST_URL instead.`,
  );
};

export const resolveStoreContext = async (context: OdtStoreContext): Promise<OdtStoreOptions> => {
  rejectLegacyContract(context);

  const repoPath =
    normalizeOptionalInput(context.repoPath) ??
    normalizeOptionalInput(process.env.ODT_REPO_PATH) ??
    process.cwd();
  if (!repoPath) {
    throw new Error("Missing repository path for OpenDucktor MCP.");
  }

  const normalizedRepoPath = await resolveCanonicalPath(repoPath);
  const metadataNamespace =
    normalizeOptionalInput(context.metadataNamespace) ??
    normalizeOptionalInput(process.env.ODT_METADATA_NAMESPACE) ??
    "openducktor";

  const hostUrl =
    normalizeOptionalInput(context.hostUrl) ?? normalizeOptionalInput(process.env.ODT_HOST_URL);
  if (!hostUrl) {
    throw new Error("Missing Rust host URL for OpenDucktor MCP. Provide ODT_HOST_URL.");
  }

  try {
    new URL(hostUrl);
  } catch {
    throw new Error(`Invalid ODT_HOST_URL for OpenDucktor MCP: ${hostUrl}`);
  }

  const resolved = {
    repoPath: normalizedRepoPath,
    hostUrl,
    metadataNamespace,
  };

  await new OdtHostBridgeClient({ baseUrl: hostUrl, repoPath: normalizedRepoPath }).ready();

  return resolved;
};
