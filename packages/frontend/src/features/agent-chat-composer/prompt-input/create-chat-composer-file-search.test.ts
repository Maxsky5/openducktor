import { describe, expect, mock, test } from "bun:test";
import type { AgentFileSearchResult } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";
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
): ChatComposerPromptInputRuntime => ({
  state: "available",
  scope: "session",
  runtimeRef: {
    repoPath: "/repo",
    runtimeKind,
    workingDirectory: "/repo/worktree",
  },
});

const repoTarget = (
  runtimeKind: "codex" | "opencode" = "opencode",
): ChatComposerPromptInputRuntime => ({
  state: "available",
  scope: "repo",
  runtimeRef: {
    repoPath: "/repo",
    runtimeKind,
    workingDirectory: "/repo",
  },
});

describe("createChatComposerFileSearch", () => {
  test("fails fast on unready runtime before unsupported capability handling", async () => {
    const loadFileSearchForRepo = mock(async () => makeFileSearchResults());
    const searchFiles = createChatComposerFileSearch({
      promptInputRuntime: {
        state: "waiting",
        runtimeKind: "opencode",
        message: "File search is unavailable until the runtime is ready.",
      },
      supportsFileSearch: false,
      queryClient: createQueryClient(),
      loadFileSearchForRepo,
    });

    await expect(searchFiles("src")).rejects.toThrow(
      "File search is unavailable until the runtime is ready.",
    );
    expect(loadFileSearchForRepo).not.toHaveBeenCalled();
  });

  test("returns empty results for ready sessions on runtimes without file search", async () => {
    const loadFileSearchForRepo = mock(async () => makeFileSearchResults());
    const searchFiles = createChatComposerFileSearch({
      promptInputRuntime: sessionTarget(),
      supportsFileSearch: false,
      queryClient: createQueryClient(),
      loadFileSearchForRepo,
    });

    await expect(searchFiles("src")).resolves.toEqual([]);
    expect(loadFileSearchForRepo).not.toHaveBeenCalled();
  });

  test("throws when selected session runtime resolution failed", async () => {
    const loadFileSearchForRepo = mock(async () => makeFileSearchResults());
    const searchFiles = createChatComposerFileSearch({
      promptInputRuntime: {
        state: "unavailable",
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

  test("throws when no session has no workspace repo path", async () => {
    const searchFiles = createChatComposerFileSearch({
      promptInputRuntime: {
        state: "unavailable",
        runtimeKind: null,
        error: "No repository selected.",
      },
      supportsFileSearch: true,
      queryClient: createQueryClient(),
      loadFileSearchForRepo: async () => makeFileSearchResults(),
    });

    await expect(searchFiles("src")).rejects.toThrow("No repository selected.");
  });

  test("throws when no session has no selected runtime kind", async () => {
    const searchFiles = createChatComposerFileSearch({
      promptInputRuntime: {
        state: "unavailable",
        runtimeKind: null,
        error: "Select a runtime before using prompt input.",
      },
      supportsFileSearch: true,
      queryClient: createQueryClient(),
      loadFileSearchForRepo: async () => makeFileSearchResults(),
    });

    await expect(searchFiles("src")).rejects.toThrow("Select a runtime before using prompt input.");
  });

  test("returns empty results for new sessions on runtimes without file search", async () => {
    const loadFileSearchForRepo = mock(async () => makeFileSearchResults());
    const searchFiles = createChatComposerFileSearch({
      promptInputRuntime: repoTarget(),
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
      promptInputRuntime: repoTarget("codex"),
      supportsFileSearch: true,
      queryClient: createQueryClient(),
      loadFileSearchForRepo,
    });

    await expect(searchFiles("")).resolves.toEqual(makeFileSearchResults());
    expect(loadFileSearchForRepo).toHaveBeenCalledWith(
      {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
      },
      "",
    );
  });

  test("searches session-scoped files through the Codex session working directory", async () => {
    const loadFileSearchForRepo = mock(async () => makeFileSearchResults());
    const searchFiles = createChatComposerFileSearch({
      promptInputRuntime: sessionTarget("codex"),
      supportsFileSearch: true,
      queryClient: createQueryClient(),
      loadFileSearchForRepo,
    });

    await expect(searchFiles("src")).resolves.toEqual(makeFileSearchResults());
    expect(loadFileSearchForRepo).toHaveBeenCalledWith(
      {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
      },
      "src",
    );
  });
});
