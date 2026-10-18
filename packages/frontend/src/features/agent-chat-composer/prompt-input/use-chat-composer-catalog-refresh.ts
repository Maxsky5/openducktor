import type { AgentRuntimeCatalog, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { useCallback } from "react";
import { useRefreshStaleRuntimeCatalog } from "@openducktor/frontend-core/queries/use-runtime-catalog-query";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";

type UseChatComposerCatalogRefreshArgs = {
  promptInputRuntime: ChatComposerPromptInputRuntime;
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
};

export const useChatComposerCatalogRefresh = ({
  promptInputRuntime,
  loadRuntimeCatalog,
}: UseChatComposerCatalogRefreshArgs): (() => void) => {
  const refreshStaleCatalog = useRefreshStaleRuntimeCatalog(loadRuntimeCatalog);
  const runtimeRef =
    promptInputRuntime.state === "available" ? promptInputRuntime.runtimeRef : null;

  return useCallback(() => {
    if (runtimeRef === null) {
      return;
    }
    refreshStaleCatalog(runtimeRef);
  }, [refreshStaleCatalog, runtimeRef]);
};
