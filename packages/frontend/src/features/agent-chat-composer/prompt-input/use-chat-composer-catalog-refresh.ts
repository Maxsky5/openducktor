import type { AgentRuntimeCatalog, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { refreshRuntimeCatalogIfStale } from "@/state/queries/runtime-catalog";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";

type UseChatComposerCatalogRefreshArgs = {
  promptInputRuntime: ChatComposerPromptInputRuntime;
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
};

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
    refreshRuntimeCatalogIfStale(queryClient, runtimeRef, loadRuntimeCatalog);
  }, [loadRuntimeCatalog, queryClient, runtimeRef]);
};
