import { describe, expect, mock, test } from "bun:test";
import type { AgentFileSearchResult } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import { createChatComposerFileSearch } from "./create-chat-composer-file-search";

const makeFileSearchResults = (): AgentFileSearchResult[] => [
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

describe("createChatComposerFileSearch", () => {
  test("fails fast on unready active session runtime before unsupported capability handling", async () => {
    const readSessionFileSearch = mock(async () => makeFileSearchResults());
    const searchFiles = createChatComposerFileSearch({
      hasActiveSession: true,
      activeSessionRuntimeQueryInput: null,
      activeSessionRuntimeQueryError: null,
      workspaceRepoPath: "/repo",
      selectedRuntimeKind: "opencode",
      supportsFileSearch: false,
      queryClient: createQueryClient(),
      loadFileSearchForRepo: async () => makeFileSearchResults(),
      readSessionFileSearch,
    });

    await expect(searchFiles("src")).rejects.toThrow(
      "Active session file search is unavailable until the session runtime is ready.",
    );
    expect(readSessionFileSearch).not.toHaveBeenCalled();
  });

  test("returns empty results for ready active sessions on runtimes without file search", async () => {
    const readSessionFileSearch = mock(async () => makeFileSearchResults());
    const searchFiles = createChatComposerFileSearch({
      hasActiveSession: true,
      activeSessionRuntimeQueryInput: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      },
      activeSessionRuntimeQueryError: null,
      workspaceRepoPath: "/repo",
      selectedRuntimeKind: "opencode",
      supportsFileSearch: false,
      queryClient: createQueryClient(),
      loadFileSearchForRepo: async () => makeFileSearchResults(),
      readSessionFileSearch,
    });

    await expect(searchFiles("src")).resolves.toEqual([]);
    expect(readSessionFileSearch).not.toHaveBeenCalled();
  });

  test("does not require the session file-search adapter for unsupported active sessions", async () => {
    const searchFiles = createChatComposerFileSearch({
      hasActiveSession: true,
      activeSessionRuntimeQueryInput: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      },
      activeSessionRuntimeQueryError: null,
      workspaceRepoPath: "/repo",
      selectedRuntimeKind: "opencode",
      supportsFileSearch: false,
      queryClient: createQueryClient(),
      loadFileSearchForRepo: async () => makeFileSearchResults(),
    });

    await expect(searchFiles("src")).resolves.toEqual([]);
  });

  test("throws when supported active sessions have no file-search adapter", async () => {
    const searchFiles = createChatComposerFileSearch({
      hasActiveSession: true,
      activeSessionRuntimeQueryInput: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      },
      activeSessionRuntimeQueryError: null,
      workspaceRepoPath: "/repo",
      selectedRuntimeKind: "opencode",
      supportsFileSearch: true,
      queryClient: createQueryClient(),
      loadFileSearchForRepo: async () => makeFileSearchResults(),
    });

    await expect(searchFiles("src")).rejects.toThrow(
      "Active session file search adapter is unavailable.",
    );
  });

  test("throws when active session runtime resolution failed", async () => {
    const searchFiles = createChatComposerFileSearch({
      hasActiveSession: true,
      activeSessionRuntimeQueryInput: null,
      activeSessionRuntimeQueryError: "Runtime query failed",
      workspaceRepoPath: "/repo",
      selectedRuntimeKind: "opencode",
      supportsFileSearch: true,
      queryClient: createQueryClient(),
      loadFileSearchForRepo: async () => makeFileSearchResults(),
    });

    await expect(searchFiles("src")).rejects.toThrow("Runtime query failed");
  });

  test("throws when no active session has no workspace repo path", async () => {
    const searchFiles = createChatComposerFileSearch({
      hasActiveSession: false,
      activeSessionRuntimeQueryInput: null,
      activeSessionRuntimeQueryError: null,
      workspaceRepoPath: null,
      selectedRuntimeKind: "opencode",
      supportsFileSearch: true,
      queryClient: createQueryClient(),
      loadFileSearchForRepo: async () => makeFileSearchResults(),
    });

    await expect(searchFiles("src")).rejects.toThrow("No repository selected.");
  });

  test("throws when no active session has no selected runtime kind", async () => {
    const searchFiles = createChatComposerFileSearch({
      hasActiveSession: false,
      activeSessionRuntimeQueryInput: null,
      activeSessionRuntimeQueryError: null,
      workspaceRepoPath: "/repo",
      selectedRuntimeKind: null,
      supportsFileSearch: true,
      queryClient: createQueryClient(),
      loadFileSearchForRepo: async () => makeFileSearchResults(),
    });

    await expect(searchFiles("src")).rejects.toThrow("Select a runtime before searching files.");
  });

  test("returns empty results for new sessions on runtimes without file search", async () => {
    const loadFileSearchForRepo = mock(async () => makeFileSearchResults());
    const searchFiles = createChatComposerFileSearch({
      hasActiveSession: false,
      activeSessionRuntimeQueryInput: null,
      activeSessionRuntimeQueryError: null,
      workspaceRepoPath: "/repo",
      selectedRuntimeKind: "opencode",
      supportsFileSearch: false,
      queryClient: createQueryClient(),
      loadFileSearchForRepo,
    });

    await expect(searchFiles("src")).resolves.toEqual([]);
    expect(loadFileSearchForRepo).not.toHaveBeenCalled();
  });
});
