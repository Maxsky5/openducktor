import { describe, expect, mock, test } from "bun:test";
import type { AgentFileSearchResult } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import type { ChatComposerPromptInputTarget } from "./chat-composer-prompt-input-target";
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

const sessionTarget = (
  runtimeKind: "codex" | "opencode" = "opencode",
): ChatComposerPromptInputTarget => ({
  kind: "session",
  runtimeRef: {
    repoPath: "/repo",
    runtimeKind,
    workingDirectory: "/repo/worktree",
  },
});

const repoTarget = (
  runtimeKind: "codex" | "opencode" = "opencode",
): ChatComposerPromptInputTarget => ({
  kind: "repo",
  repoPath: "/repo",
  runtimeKind,
});

describe("createChatComposerFileSearch", () => {
  test("fails fast on unready active session runtime before unsupported capability handling", async () => {
    const readSessionFileSearch = mock(async () => makeFileSearchResults());
    const searchFiles = createChatComposerFileSearch({
      promptInputTarget: { kind: "sessionLoading", runtimeKind: "opencode" },
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
      promptInputTarget: sessionTarget(),
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
      promptInputTarget: sessionTarget(),
      supportsFileSearch: false,
      queryClient: createQueryClient(),
      loadFileSearchForRepo: async () => makeFileSearchResults(),
    });

    await expect(searchFiles("src")).resolves.toEqual([]);
  });

  test("throws when supported active sessions have no file-search adapter", async () => {
    const searchFiles = createChatComposerFileSearch({
      promptInputTarget: sessionTarget(),
      supportsFileSearch: true,
      queryClient: createQueryClient(),
      loadFileSearchForRepo: async () => makeFileSearchResults(),
    });

    await expect(searchFiles("src")).rejects.toThrow(
      "Active session file search adapter is unavailable.",
    );
  });

  test("throws when active session runtime resolution failed", async () => {
    const loadFileSearchForRepo = mock(async () => makeFileSearchResults());
    const searchFiles = createChatComposerFileSearch({
      promptInputTarget: {
        kind: "unavailable",
        runtimeKind: "opencode",
        error: "Runtime query failed",
      },
      supportsFileSearch: true,
      queryClient: createQueryClient(),
      loadFileSearchForRepo,
    });

    await expect(searchFiles("src")).rejects.toThrow("Runtime query failed");
    expect(loadFileSearchForRepo).not.toHaveBeenCalled();
  });

  test("throws when no active session has no workspace repo path", async () => {
    const searchFiles = createChatComposerFileSearch({
      promptInputTarget: { kind: "noRepo" },
      supportsFileSearch: true,
      queryClient: createQueryClient(),
      loadFileSearchForRepo: async () => makeFileSearchResults(),
    });

    await expect(searchFiles("src")).rejects.toThrow("No repository selected.");
  });

  test("throws when no active session has no selected runtime kind", async () => {
    const searchFiles = createChatComposerFileSearch({
      promptInputTarget: { kind: "noRuntime", repoPath: "/repo" },
      supportsFileSearch: true,
      queryClient: createQueryClient(),
      loadFileSearchForRepo: async () => makeFileSearchResults(),
    });

    await expect(searchFiles("src")).rejects.toThrow("Select a runtime before searching files.");
  });

  test("returns empty results for new sessions on runtimes without file search", async () => {
    const loadFileSearchForRepo = mock(async () => makeFileSearchResults());
    const searchFiles = createChatComposerFileSearch({
      promptInputTarget: repoTarget(),
      supportsFileSearch: false,
      queryClient: createQueryClient(),
      loadFileSearchForRepo,
    });

    await expect(searchFiles("src")).resolves.toEqual([]);
    expect(loadFileSearchForRepo).not.toHaveBeenCalled();
  });

  test("searches repo files through a supported Codex repo runtime before a session starts", async () => {
    const loadFileSearchForRepo = mock(async () => makeFileSearchResults());
    const searchFiles = createChatComposerFileSearch({
      promptInputTarget: repoTarget("codex"),
      supportsFileSearch: true,
      queryClient: createQueryClient(),
      loadFileSearchForRepo,
    });

    await expect(searchFiles("")).resolves.toEqual(makeFileSearchResults());
    expect(loadFileSearchForRepo).toHaveBeenCalledWith("/repo", "codex", "");
  });

  test("searches active-session files through the Codex session working directory", async () => {
    const loadFileSearchForRepo = mock(async () => makeFileSearchResults());
    const readSessionFileSearch = mock(async () => makeFileSearchResults());
    const searchFiles = createChatComposerFileSearch({
      promptInputTarget: sessionTarget("codex"),
      supportsFileSearch: true,
      queryClient: createQueryClient(),
      loadFileSearchForRepo,
      readSessionFileSearch,
    });

    await expect(searchFiles("src")).resolves.toEqual(makeFileSearchResults());
    expect(readSessionFileSearch).toHaveBeenCalledWith("/repo", "codex", "/repo/worktree", "src");
    expect(loadFileSearchForRepo).not.toHaveBeenCalled();
  });
});
