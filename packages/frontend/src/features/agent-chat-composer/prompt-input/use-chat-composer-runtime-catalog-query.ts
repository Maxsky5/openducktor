import type { AgentRuntimeCatalog, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import {
  runtimeCatalogQueryOptions,
  skippedRuntimeCatalogQueryOptions,
} from "@/state/queries/runtime-catalog";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";

type UseChatComposerRuntimeCatalogQueryArgs = {
  promptInputRuntime: ChatComposerPromptInputRuntime;
  supports: boolean;
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
};

export const useChatComposerRuntimeCatalogQuery = ({
  promptInputRuntime,
  supports,
  loadRuntimeCatalog,
}: UseChatComposerRuntimeCatalogQueryArgs) => {
  const runtimeRef =
    promptInputRuntime.state === "available" ? promptInputRuntime.runtimeRef : null;
  return useQuery({
    ...(runtimeRef
      ? runtimeCatalogQueryOptions(runtimeRef, loadRuntimeCatalog)
      : skippedRuntimeCatalogQueryOptions()),
    enabled: runtimeRef !== null && supports,
  });
};
