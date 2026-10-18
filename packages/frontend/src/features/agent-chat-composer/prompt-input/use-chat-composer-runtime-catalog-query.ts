import type { AgentRuntimeCatalog, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { useRuntimeCatalogQuery } from "@openducktor/frontend-core/queries/use-runtime-catalog-query";
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
}: UseChatComposerRuntimeCatalogQueryArgs) =>
  useRuntimeCatalogQuery({
    runtimeRef: promptInputRuntime.state === "available" ? promptInputRuntime.runtimeRef : null,
    loadRuntimeCatalog,
    enabled: supports,
  });
