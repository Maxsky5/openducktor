import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentFileSearchResult } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { SessionRuntimeQueryInput } from "@/state/operations/agent-orchestrator/support/session-runtime-query-state";
import { sessionFileSearchQueryOptions } from "@/state/queries/agent-session-runtime";
import { repoRuntimeFileSearchQueryOptions } from "@/state/queries/runtime-catalog";

export const createAgentStudioFileSearch = ({
  hasActiveSession,
  activeSessionRuntimeQueryInput,
  activeSessionRuntimeQueryError,
  workspaceRepoPath,
  composerRuntimeKind,
  supportsFileSearch,
  queryClient,
  loadFileSearchForRepo,
  readSessionFileSearch,
}: {
  hasActiveSession: boolean;
  activeSessionRuntimeQueryInput: SessionRuntimeQueryInput | null;
  activeSessionRuntimeQueryError: string | null;
  workspaceRepoPath: string | null;
  composerRuntimeKind: RuntimeKind | null;
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
      if (!supportsFileSearch) {
        return [];
      }
      if (activeSessionRuntimeQueryInput == null || readSessionFileSearch == null) {
        throw new Error(
          "Active session file search is unavailable until the session runtime is ready.",
        );
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
    if (!composerRuntimeKind) {
      throw new Error("Select a runtime before searching files.");
    }
    if (!supportsFileSearch) {
      return [];
    }
    return queryClient.fetchQuery(
      repoRuntimeFileSearchQueryOptions(
        workspaceRepoPath,
        composerRuntimeKind,
        query,
        loadFileSearchForRepo,
      ),
    );
  };
};
