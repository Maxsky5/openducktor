import type { AgentRuntimeCatalogSurfaceName } from "@openducktor/contracts";
import type { AgentRuntimeCatalogSurfaceRead } from "../ports/agent-engine";

export const readAgentRuntimeCatalogSurface = async <Catalog>(
  read: () => Promise<Catalog>,
): Promise<AgentRuntimeCatalogSurfaceRead<Catalog>> => {
  try {
    return { status: "available", catalog: await read() };
  } catch (cause) {
    return { status: "failed", cause };
  }
};

/**
 * A retry reads only the failed surface. The caller sends the surface list; an
 * absent list reads every supported surface.
 */
export const isAgentRuntimeCatalogSurfaceRequested = (
  surfaces: readonly AgentRuntimeCatalogSurfaceName[] | undefined,
  surface: AgentRuntimeCatalogSurfaceName,
): boolean => surfaces === undefined || surfaces.includes(surface);
