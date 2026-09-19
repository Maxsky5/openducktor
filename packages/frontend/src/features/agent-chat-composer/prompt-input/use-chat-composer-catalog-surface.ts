import type { AgentRuntimeCatalogSurfaceName } from "@openducktor/contracts";
import type {
  AgentRuntimeCatalog,
  AgentRuntimeCatalogSurface,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import {
  retryRuntimeCatalogSurface,
  resolveRuntimeCatalogSurface,
} from "@/state/queries/runtime-catalog";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";
import { useChatComposerRuntimeCatalogQuery } from "./use-chat-composer-runtime-catalog-query";

type UseChatComposerCatalogSurfaceArgs<Catalog> = {
  promptInputRuntime: ChatComposerPromptInputRuntime;
  supports: boolean;
  surface: AgentRuntimeCatalogSurfaceName;
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
  selectSurface: (
    catalog: AgentRuntimeCatalog | undefined,
  ) => AgentRuntimeCatalogSurface<Catalog> | undefined;
  emptyCatalog: Catalog;
};

export const useChatComposerCatalogSurface = <Catalog>({
  promptInputRuntime,
  supports,
  surface,
  loadRuntimeCatalog,
  selectSurface,
  emptyCatalog,
}: UseChatComposerCatalogSurfaceArgs<Catalog>) => {
  const queryClient = useQueryClient();
  const catalogQuery = useChatComposerRuntimeCatalogQuery({
    promptInputRuntime,
    supports,
    loadRuntimeCatalog,
  });
  const resolved = resolveRuntimeCatalogSurface(
    selectSurface(catalogQuery.data),
    catalogQuery.error,
  );

  let catalog = emptyCatalog;
  let error: string | null = null;
  let isLoading = false;
  if (supports && promptInputRuntime.state === "unavailable") {
    error = promptInputRuntime.error;
  } else if (supports && promptInputRuntime.state === "available") {
    catalog = resolved.catalog ?? emptyCatalog;
    error = resolved.error;
    isLoading = catalogQuery.isLoading;
  }

  // A failed surface stays retryable from the surface that needs it. The retry
  // reads only that surface and merges it into the cached catalog entry, so
  // surfaces that succeeded are not re-read.
  const runtimeRef =
    promptInputRuntime.state === "available" ? promptInputRuntime.runtimeRef : null;
  const retry =
    supports && runtimeRef !== null
      ? () => {
          void retryRuntimeCatalogSurface({
            queryClient,
            runtimeRef,
            surface,
            loadRuntimeCatalog,
          });
        }
      : null;

  return { catalog, error, isLoading, retry };
};
