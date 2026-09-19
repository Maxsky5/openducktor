import type { AgentRuntimeCatalog, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { runtimeCatalogQueryOptions } from "@/state/queries/runtime-catalog";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";

type UseChatComposerCatalogRefreshArgs = {
  promptInputRuntime: ChatComposerPromptInputRuntime;
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
};

// The next consumer action (a menu open) fetches the combined catalog when the
// cached entry is stale. A fresh entry is reused without a request.
export const useChatComposerCatalogRefresh = ({
  promptInputRuntime,
  loadRuntimeCatalog,
}: UseChatComposerCatalogRefreshArgs): (() => void) => {
  const queryClient = useQueryClient();
  const runtimeRef =
    promptInputRuntime.state === "available" ? promptInputRuntime.runtimeRef : null;

  return useCallback(() => {
    if (runtimeRef === null) {
      return;
    }
    void queryClient
      .fetchQuery(runtimeCatalogQueryOptions(runtimeRef, loadRuntimeCatalog))
      .catch(() => undefined);
  }, [loadRuntimeCatalog, queryClient, runtimeRef]);
};
