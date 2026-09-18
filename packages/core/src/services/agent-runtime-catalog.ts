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
