import type {
  AgentRuntimeCatalog,
  AgentRuntimeCatalogSurface,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { resolveRuntimeCatalogSurface } from "@/state/queries/runtime-catalog";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";
import { useChatComposerRuntimeCatalogQuery } from "./use-chat-composer-runtime-catalog-query";

type UseChatComposerCatalogSurfaceArgs<Catalog> = {
  promptInputRuntime: ChatComposerPromptInputRuntime;
  supports: boolean;
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
  selectSurface: (
    catalog: AgentRuntimeCatalog | undefined,
  ) => AgentRuntimeCatalogSurface<Catalog> | undefined;
  emptyCatalog: Catalog;
};

export const useChatComposerCatalogSurface = <Catalog>({
  promptInputRuntime,
  supports,
  loadRuntimeCatalog,
  selectSurface,
  emptyCatalog,
}: UseChatComposerCatalogSurfaceArgs<Catalog>) => {
  const catalogQuery = useChatComposerRuntimeCatalogQuery({
    promptInputRuntime,
    supports,
    loadRuntimeCatalog,
  });
  const surface = resolveRuntimeCatalogSurface(
    selectSurface(catalogQuery.data),
    catalogQuery.error,
  );

  let catalog = emptyCatalog;
  let error: string | null = null;
  let isLoading = false;
  if (supports && promptInputRuntime.state === "unavailable") {
    error = promptInputRuntime.error;
  } else if (supports && promptInputRuntime.state === "available") {
    catalog = surface.catalog ?? emptyCatalog;
    error = surface.error;
    isLoading = catalogQuery.isLoading;
  }

  return { catalog, error, isLoading };
};
