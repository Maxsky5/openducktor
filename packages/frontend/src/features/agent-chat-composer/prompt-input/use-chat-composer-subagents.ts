import type {
  AgentRuntimeCatalog,
  AgentSubagentCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import {
  resolveRuntimeCatalogSurface,
  runtimeCatalogQueryOptions,
  skippedRuntimeCatalogQueryOptions,
} from "@/state/queries/runtime-catalog";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";

const EMPTY_SUBAGENT_CATALOG: AgentSubagentCatalog = { subagents: [] };

type UseChatComposerSubagentsArgs = {
  promptInputRuntime: ChatComposerPromptInputRuntime;
  supportsSubagentReferences: boolean;
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
};

export const useChatComposerSubagents = ({
  promptInputRuntime,
  supportsSubagentReferences,
  loadRuntimeCatalog,
}: UseChatComposerSubagentsArgs) => {
  const runtimeRef =
    promptInputRuntime.state === "available" ? promptInputRuntime.runtimeRef : null;
  const catalogQuery = useQuery({
    ...(runtimeRef
      ? runtimeCatalogQueryOptions(runtimeRef, loadRuntimeCatalog)
      : skippedRuntimeCatalogQueryOptions()),
    enabled: runtimeRef !== null && supportsSubagentReferences,
  });
  const surface = resolveRuntimeCatalogSurface(catalogQuery.data?.subagents, catalogQuery.error);

  let catalog = EMPTY_SUBAGENT_CATALOG;
  let error: string | null = null;
  let isLoading = false;
  if (supportsSubagentReferences && promptInputRuntime.state === "unavailable") {
    error = promptInputRuntime.error;
  } else if (supportsSubagentReferences && promptInputRuntime.state === "available") {
    catalog = surface.catalog ?? EMPTY_SUBAGENT_CATALOG;
    error = surface.error;
    isLoading = catalogQuery.isLoading;
  }

  return {
    subagentCatalog: catalog,
    subagents: supportsSubagentReferences ? catalog.subagents : [],
    subagentsError: error,
    isSubagentsLoading: isLoading,
  } satisfies {
    subagentCatalog: AgentSubagentCatalog;
    subagents: AgentSubagentCatalog["subagents"];
    subagentsError: string | null;
    isSubagentsLoading: boolean;
  };
};
