import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentFileSearchResult } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { sessionFileSearchQueryOptions } from "@/state/queries/agent-session-runtime";
import { repoRuntimeFileSearchQueryOptions } from "@/state/queries/runtime-catalog";
import type { ChatComposerPromptInputTarget } from "./chat-composer-prompt-input-target";

export const createChatComposerFileSearch = ({
  promptInputTarget,
  supportsFileSearch,
  queryClient,
  loadFileSearchForRepo,
  readSessionFileSearch,
}: {
  promptInputTarget: ChatComposerPromptInputTarget;
  supportsFileSearch: boolean;
  queryClient: QueryClient;
  loadFileSearchForRepo: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    query: string,
  ) => Promise<AgentFileSearchResult[]>;
  readSessionFileSearch?: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
    query: string,
  ) => Promise<AgentFileSearchResult[]>;
}): ((query: string) => Promise<AgentFileSearchResult[]>) => {
  return async (query: string): Promise<AgentFileSearchResult[]> => {
    if (promptInputTarget.kind === "sessionLoading") {
      throw new Error(
        "Active session file search is unavailable until the session runtime is ready.",
      );
    }
    if (promptInputTarget.kind === "unavailable") {
      throw new Error(promptInputTarget.error);
    }
    if (promptInputTarget.kind === "session") {
      if (!supportsFileSearch) {
        return [];
      }
      if (readSessionFileSearch == null) {
        throw new Error("Active session file search adapter is unavailable.");
      }
      return queryClient.fetchQuery(
        sessionFileSearchQueryOptions(
          promptInputTarget.runtimeRef.repoPath,
          promptInputTarget.runtimeRef.runtimeKind,
          promptInputTarget.runtimeRef.workingDirectory,
          query,
          readSessionFileSearch,
        ),
      );
    }

    if (promptInputTarget.kind === "noRepo") {
      throw new Error("No repository selected.");
    }
    if (promptInputTarget.kind === "noRuntime") {
      throw new Error("Select a runtime before searching files.");
    }
    if (!supportsFileSearch) {
      return [];
    }
    return queryClient.fetchQuery(
      repoRuntimeFileSearchQueryOptions(
        promptInputTarget.repoPath,
        promptInputTarget.runtimeKind,
        query,
        loadFileSearchForRepo,
      ),
    );
  };
};
