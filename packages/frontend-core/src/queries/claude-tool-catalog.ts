import type { ClaudeToolCatalog, ClaudeToolCatalogInput } from "@openducktor/contracts";
import { queryOptions, type QueryKey } from "@tanstack/react-query";
import { skippedQueryOptions } from "./skipped-query";

export const claudeToolCatalogQueryOptions = (
  hostInstanceId: string,
  runtimeId: string,
  load: (input: ClaudeToolCatalogInput) => Promise<ClaudeToolCatalog>,
) =>
  queryOptions<ClaudeToolCatalog, Error, ClaudeToolCatalog, QueryKey>({
    queryKey: ["claude-tool-catalog", hostInstanceId, runtimeId] as const,
    queryFn: async () => {
      const catalog = await load({ runtimeId });
      if (catalog.runtimeId !== runtimeId)
        throw new Error("Claude changed during the tool catalog read. Retry the read.");
      return catalog;
    },
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: false,
  });

export const skippedClaudeToolCatalogQueryOptions = () =>
  skippedQueryOptions<ClaudeToolCatalog>({
    queryKey: ["claude-tool-catalog", "skipped"],
    staleTime: 30 * 60_000,
  });
