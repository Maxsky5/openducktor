import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentFileSearchResult } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { SessionRuntimeQueryInput } from "@/state/operations/agent-orchestrator/support/session-runtime-query-state";
import { sessionFileSearchQueryOptions } from "@/state/queries/agent-session-runtime";
import { repoRuntimeFileSearchQueryOptions } from "@/state/queries/runtime-catalog";

export const createChatComposerFileSearch = ({
  hasActiveSession,
  activeSessionRuntimeQueryInput,
  activeSessionRuntimeQueryError,
  workspaceRepoPath,
  selectedRuntimeKind,
  supportsFileSearch,
  queryClient,
  loadFileSearchForRepo,
  readSessionFileSearch,
}: {
  hasActiveSession: boolean;
  activeSessionRuntimeQueryInput: SessionRuntimeQueryInput | null;
  activeSessionRuntimeQueryError: string | null;
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
      if (activeSessionRuntimeQueryError) {
        throw new Error(activeSessionRuntimeQueryError);
      }
      if (activeSessionRuntimeQueryInput == null) {
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
          activeSessionRuntimeQueryInput.repoPath,
          activeSessionRuntimeQueryInput.runtimeKind,
          activeSessionRuntimeQueryInput.workingDirectory,
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
