import { normalizeOptionalInput, resolveCanonicalPath } from "./beads-runtime";

export type OdtStoreOptions = {
  repoPath: string;
  beadsDir?: string;
  metadataNamespace: string;
};

export type OdtStoreContext = {
  repoPath?: string;
  beadsDir?: string;
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

  const beadsDir =
    normalizeOptionalInput(context.beadsDir) ??
    normalizeOptionalInput(process.env.ODT_BEADS_DIR) ??
    normalizeOptionalInput(process.env.BEADS_DIR);

  return {
    repoPath: normalizedRepoPath,
    metadataNamespace,
    ...(beadsDir ? { beadsDir } : {}),
  };
};
