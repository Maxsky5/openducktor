import { loadModelCatalog } from "./catalog-and-mcp";
import { buildDefaultFactory } from "./client-factory";

export const loadOpencodeModelCatalogFromEndpoint = async (
  repoPath: string,
  runtimeEndpoint: string,
): ReturnType<typeof loadModelCatalog> =>
  loadModelCatalog(buildDefaultFactory(), {
    repoPath,
    workingDirectory: repoPath,
    runtimeEndpoint,
  });
