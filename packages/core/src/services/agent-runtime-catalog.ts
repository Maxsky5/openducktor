import type { AgentRuntimeCatalogSurfaceRead } from "../ports/agent-engine";
import { AgentRuntimeQueryError } from "../ports/agent-runtime-query-error";

/**
 * A native runtime-query failure means the runtime is unreachable, so it fails
 * the whole combined read. Every other failure stays local to this surface.
 */
export const readCatalogSurface = async <Catalog>(
  read: () => Promise<Catalog>,
): Promise<AgentRuntimeCatalogSurfaceRead<Catalog>> => {
  try {
    return { status: "available", catalog: await read() };
  } catch (cause) {
    if (cause instanceof AgentRuntimeQueryError) {
      throw cause;
    }
    return { status: "failed", cause };
  }
};
