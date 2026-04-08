import { normalizeOptionalInput, resolveCanonicalPath } from "./beads-runtime";

export type OdtStoreOptions = {
  repoPath: string;
  beadsAttachmentDir?: string;
  doltHost?: string;
  doltPort?: string;
  databaseName?: string;
  metadataNamespace: string;
};

export type OdtStoreContext = {
  repoPath?: string;
  beadsAttachmentDir?: string;
  doltHost?: string;
  doltPort?: string;
  databaseName?: string;
  metadataNamespace?: string;
};

export const resolveStoreContext = async (context: OdtStoreContext): Promise<OdtStoreOptions> => {
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

  const beadsAttachmentDir =
    normalizeOptionalInput(context.beadsAttachmentDir) ??
    normalizeOptionalInput(process.env.ODT_BEADS_ATTACHMENT_DIR);
  const doltHost =
    normalizeOptionalInput(context.doltHost) ?? normalizeOptionalInput(process.env.ODT_DOLT_HOST);
  const doltPort =
    normalizeOptionalInput(context.doltPort) ?? normalizeOptionalInput(process.env.ODT_DOLT_PORT);
  const databaseName =
    normalizeOptionalInput(context.databaseName) ??
    normalizeOptionalInput(process.env.ODT_DATABASE_NAME);

  if (!beadsAttachmentDir) {
    throw new Error(
      "Missing Beads attachment directory for OpenDucktor MCP. Provide ODT_BEADS_ATTACHMENT_DIR.",
    );
  }
  if (!doltHost) {
    throw new Error("Missing Dolt host for OpenDucktor MCP. Provide ODT_DOLT_HOST.");
  }
  if (!doltPort) {
    throw new Error("Missing Dolt port for OpenDucktor MCP. Provide ODT_DOLT_PORT.");
  }
  if (!databaseName) {
    throw new Error("Missing Dolt database name for OpenDucktor MCP. Provide ODT_DATABASE_NAME.");
  }

  return {
    repoPath: normalizedRepoPath,
    metadataNamespace,
    beadsAttachmentDir,
    doltHost,
    doltPort,
    databaseName,
  };
};
