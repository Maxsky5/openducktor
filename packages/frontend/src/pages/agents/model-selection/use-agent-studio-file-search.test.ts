import { describe, expect, mock, test } from "bun:test";
import type { AgentFileSearchResult } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import { createAgentStudioFileSearch } from "./use-agent-studio-file-search";

const FILE_SEARCH_RESULTS: AgentFileSearchResult[] = [
  {
    id: "src/main.ts",
    path: "src/main.ts",
    name: "main.ts",
    kind: "code",
  },
];

const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

describe("createAgentStudioFileSearch", () => {
  test("fails fast on unready active session runtime before unsupported capability handling", async () => {
    const readSessionFileSearch = mock(async () => FILE_SEARCH_RESULTS);
    const searchFiles = createAgentStudioFileSearch({
      hasActiveSession: true,
      activeSessionRuntimeQueryInput: null,
      activeSessionRuntimeQueryError: null,
      workspaceRepoPath: "/repo",
      composerRuntimeKind: "opencode",
      supportsFileSearch: false,
      queryClient: createQueryClient(),
      loadFileSearchForRepo: async () => FILE_SEARCH_RESULTS,
      readSessionFileSearch,
    });

    await expect(searchFiles("src")).rejects.toThrow(
      "Active session file search is unavailable until the session runtime is ready.",
    );
    expect(readSessionFileSearch).not.toHaveBeenCalled();
  });

  test("returns empty results for ready active sessions on runtimes without file search", async () => {
    const readSessionFileSearch = mock(async () => FILE_SEARCH_RESULTS);
    const searchFiles = createAgentStudioFileSearch({
      hasActiveSession: true,
      activeSessionRuntimeQueryInput: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      },
      activeSessionRuntimeQueryError: null,
      workspaceRepoPath: "/repo",
      composerRuntimeKind: "opencode",
      supportsFileSearch: false,
      queryClient: createQueryClient(),
      loadFileSearchForRepo: async () => FILE_SEARCH_RESULTS,
      readSessionFileSearch,
    });

    await expect(searchFiles("src")).resolves.toEqual([]);
    expect(readSessionFileSearch).not.toHaveBeenCalled();
  });
});
