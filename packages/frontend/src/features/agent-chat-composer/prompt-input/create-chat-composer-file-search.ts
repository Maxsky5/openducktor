import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentFileSearchResult, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { sessionFileSearchQueryOptions } from "@/state/queries/agent-session-runtime";
import { repoRuntimeFileSearchQueryOptions } from "@/state/queries/runtime-catalog";

export const createChatComposerFileSearch = ({
  hasActiveSession,
  activeSessionRuntimeRef,
  activeSessionRuntimeRefError,
  workspaceRepoPath,
  selectedRuntimeKind,
  supportsFileSearch,
  queryClient,
  loadFileSearchForRepo,
  readSessionFileSearch,
}: {
  hasActiveSession: boolean;
  activeSessionRuntimeRef: RuntimeWorkingDirectoryRef | null;
  activeSessionRuntimeRefError: string | null;
  workspaceRepoPath: string | null;
  selectedRuntimeKind: RuntimeKind | null;
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
    if (hasActiveSession) {
      if (activeSessionRuntimeRefError) {
        throw new Error(activeSessionRuntimeRefError);
      }
      if (activeSessionRuntimeRef == null) {
        throw new Error(
          "Active session file search is unavailable until the session runtime is ready.",
        );
      }
      if (!supportsFileSearch) {
        return [];
      }
      if (readSessionFileSearch == null) {
        throw new Error("Active session file search adapter is unavailable.");
      }
      return queryClient.fetchQuery(
        sessionFileSearchQueryOptions(
          activeSessionRuntimeRef.repoPath,
          activeSessionRuntimeRef.runtimeKind,
          activeSessionRuntimeRef.workingDirectory,
          query,
          readSessionFileSearch,
        ),
      );
    }

    if (!workspaceRepoPath) {
      throw new Error("No repository selected.");
    }
    if (!selectedRuntimeKind) {
      throw new Error("Select a runtime before searching files.");
    }
    if (!supportsFileSearch) {
      return [];
    }
    return queryClient.fetchQuery(
      repoRuntimeFileSearchQueryOptions(
        workspaceRepoPath,
        selectedRuntimeKind,
        query,
        loadFileSearchForRepo,
      ),
    );
  };
};
