import type { AgentFileSearchResult, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { repoRuntimeFileSearchQueryOptions } from "@/state/queries/runtime-catalog";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";

export const createChatComposerFileSearch = ({
  promptInputRuntime,
  supportsFileSearch,
  queryClient,
  loadFileSearchForRepo,
}: {
  promptInputRuntime: ChatComposerPromptInputRuntime;
  supportsFileSearch: boolean;
  queryClient: QueryClient;
  loadFileSearchForRepo: (
    runtimeRef: RuntimeWorkingDirectoryRef,
    query: string,
  ) => Promise<AgentFileSearchResult[]>;
}): ((query: string) => Promise<AgentFileSearchResult[]>) => {
  return async (query: string): Promise<AgentFileSearchResult[]> => {
    if (promptInputRuntime.state === "waiting") {
      throw new Error(promptInputRuntime.message);
    }
    if (promptInputRuntime.state === "unavailable") {
      throw new Error(promptInputRuntime.error);
    }

    if (!supportsFileSearch) {
      return [];
    }
    return queryClient.fetchQuery(
      repoRuntimeFileSearchQueryOptions(
        promptInputRuntime.runtimeRef,
        query,
        loadFileSearchForRepo,
      ),
    );
  };
};
