import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { MixedItem, MixedSearchResult, Score } from "@ff-labs/fff-node";
import type { AgentFileSearchResult } from "@openducktor/core";
import type { ClaudeSession } from "./claude-agent-sdk-types";
import {
  createClaudeWorkspaceFileSearch,
  createNativeClaudeFileFinder,
  FILE_SEARCH_LIMIT,
  resolveUnpackedAsarModulePath,
  toClaudeFileSearchResults,
  trackClaudeFileSearchSessions,
  waitForClaudeFileScan,
  type ClaudeFileSearchSessionStore,
  type ClaudeWorkspaceFileFinder,
  type ClaudeWorkspaceFileSearch,
} from "./claude-agent-sdk-file-search";

const score: Score = {
  total: 1,
  baseScore: 1,
  filenameBonus: 0,
  specialFilenameBonus: 0,
  frecencyBoost: 0,
  distancePenalty: 0,
  currentFilePenalty: 0,
  comboMatchBoost: 0,
  exactMatch: false,
  matchType: "fuzzy",
};

const mixedResult = (items: MixedItem[]): MixedSearchResult => ({
  items,
  scores: items.map(() => score),
  totalMatched: items.length,
  totalFiles: items.filter((item) => item.type === "file").length,
  totalDirs: items.filter((item) => item.type === "directory").length,
});

const fileItem = (relativePath: string, fileName?: string): MixedItem => ({
  type: "file",
  item: {
    relativePath,
    fileName: fileName ?? relativePath.split("/").at(-1) ?? relativePath,
    size: 1,
    modified: 0,
    accessFrecencyScore: 0,
    modificationFrecencyScore: 0,
    totalFrecencyScore: 0,
    gitStatus: "clean",
  },
});

const directoryItem = (relativePath: string, dirName?: string): MixedItem => ({
  type: "directory",
  item: {
    relativePath,
    dirName: dirName ?? relativePath,
    maxAccessFrecency: 0,
  },
});

const tempDirectories: string[] = [];

const createTempDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "openducktor-claude-file-search-"));
  tempDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("toClaudeFileSearchResults", () => {
  test("maps fuzzy file and directory matches to file references", () => {
    expect(
      toClaudeFileSearchResults(
        mixedResult([
          fileItem("src/index.ts"),
          directoryItem("src/components/", "components/"),
          fileItem("assets/logo.png"),
        ]),
      ),
    ).toEqual([
      { id: "src/index.ts", path: "src/index.ts", name: "index.ts", kind: "code" },
      {
        id: "src/components",
        path: "src/components",
        name: "components",
        kind: "directory",
      },
      { id: "assets/logo.png", path: "assets/logo.png", name: "logo.png", kind: "image" },
    ]);
  });

  test("drops the root result that has an empty path", () => {
    expect(
      toClaudeFileSearchResults(mixedResult([fileItem("", ""), directoryItem("", "")])),
    ).toEqual([]);
  });

  test("strips the trailing slash from a directory path", () => {
    const [result] = toClaudeFileSearchResults(mixedResult([directoryItem("src/lib/", "lib/")]));

    expect(result).toEqual({
      id: "src/lib",
      path: "src/lib",
      name: "lib",
      kind: "directory",
    });
  });

  test("limits results to the file search limit", () => {
    const items = Array.from({ length: FILE_SEARCH_LIMIT + 5 }, (_, index) =>
      fileItem(`src/file-${index}.ts`),
    );

    expect(toClaudeFileSearchResults(mixedResult(items))).toHaveLength(FILE_SEARCH_LIMIT);
  });

  test("normalizes Windows separators in returned paths", () => {
    expect(
      toClaudeFileSearchResults(
        mixedResult([fileItem("src\\index.ts", "index.ts"), directoryItem("src\\lib\\", "lib\\")]),
      ),
    ).toEqual([
      { id: "src/index.ts", path: "src/index.ts", name: "index.ts", kind: "code" },
      { id: "src/lib", path: "src/lib", name: "lib", kind: "directory" },
    ]);
  });
});

describe("resolveUnpackedAsarModulePath", () => {
  test("rewrites an asar module path when the unpacked copy exists", async () => {
    const directory = await createTempDirectory();
    const modulePath = join(directory, "app.asar", "node_modules", "fff", "index.cjs");
    const unpackedPath = join(directory, "app.asar.unpacked", "node_modules", "fff", "index.cjs");
    await mkdir(dirname(unpackedPath), { recursive: true });
    await writeFile(unpackedPath, "module.exports = {};\n");

    expect(existsSync(modulePath)).toBe(false);
    expect(resolveUnpackedAsarModulePath(modulePath)).toBe(unpackedPath);
  });

  test("keeps a path outside an asar archive", () => {
    expect(resolveUnpackedAsarModulePath("/repo/node_modules/fff/index.cjs")).toBe(
      "/repo/node_modules/fff/index.cjs",
    );
  });

  test("reports an asar path whose unpacked copy is missing", async () => {
    const directory = await createTempDirectory();
    const modulePath = join(directory, "app.asar", "node_modules", "fff", "index.cjs");

    expect(() => resolveUnpackedAsarModulePath(modulePath)).toThrow(
      "Missing unpacked Claude file search module at",
    );
  });
});

const createFinderFactory = () => {
  const created: string[] = [];
  const destroyed: string[] = [];
  const createFinder = (workingDirectory: string): ClaudeWorkspaceFileFinder => {
    created.push(workingDirectory);
    return {
      search: async (query) => [{ id: query, path: query, name: query, kind: "default" }],
      destroy: () => {
        destroyed.push(workingDirectory);
      },
    };
  };
  return { createFinder, created, destroyed };
};

const searchFiles = (
  fileSearch: ClaudeWorkspaceFileSearch,
  workingDirectory: string,
  query: string,
): Promise<AgentFileSearchResult[]> =>
  fileSearch.search({ repoPath: "/repo", runtimeKind: "claude", workingDirectory, query });

describe("createClaudeWorkspaceFileSearch", () => {
  test("prewarms one finder per working directory and reuses it", async () => {
    const { createFinder, created, destroyed } = createFinderFactory();
    const fileSearch = createClaudeWorkspaceFileSearch({ createFinder });

    fileSearch.prewarm("/repo/a");
    fileSearch.prewarm("/repo/a");

    expect(created).toEqual(["/repo/a"]);
    expect(destroyed).toEqual([]);
    await expect(searchFiles(fileSearch, "/repo/a", "index")).resolves.toEqual([
      { id: "index", path: "index", name: "index", kind: "default" },
    ]);
  });

  test("creates a finder on demand for a directory that was not prewarmed", async () => {
    const { createFinder, created } = createFinderFactory();
    const fileSearch = createClaudeWorkspaceFileSearch({ createFinder });

    await searchFiles(fileSearch, "/repo/b", "index");

    expect(created).toEqual(["/repo/b"]);
  });

  test("destroys the least recently used finder when the cache is full", () => {
    const { createFinder, created, destroyed } = createFinderFactory();
    const fileSearch = createClaudeWorkspaceFileSearch({ createFinder, cacheLimit: 2 });

    fileSearch.prewarm("/repo/a");
    fileSearch.prewarm("/repo/b");
    fileSearch.prewarm("/repo/a");
    fileSearch.prewarm("/repo/c");

    expect(created).toEqual(["/repo/a", "/repo/b", "/repo/c"]);
    expect(destroyed).toEqual(["/repo/b"]);
  });

  test("destroys a released finder", () => {
    const { createFinder, created, destroyed } = createFinderFactory();
    const fileSearch = createClaudeWorkspaceFileSearch({ createFinder });

    fileSearch.prewarm("/repo/a");
    fileSearch.release("/repo/a");
    fileSearch.release("/repo/a");
    fileSearch.prewarm("/repo/a");

    expect(created).toEqual(["/repo/a", "/repo/a"]);
    expect(destroyed).toEqual(["/repo/a"]);
  });

  test("destroys a released finder after its in-flight search finishes", async () => {
    const destroyed: string[] = [];
    const pendingSearch = Promise.withResolvers<AgentFileSearchResult[]>();
    const fileSearch = createClaudeWorkspaceFileSearch({
      createFinder: () => ({
        search: () => pendingSearch.promise,
        destroy: () => {
          destroyed.push("/repo/a");
        },
      }),
    });

    const pending = searchFiles(fileSearch, "/repo/a", "index");
    fileSearch.release("/repo/a");
    expect(destroyed).toEqual([]);

    pendingSearch.resolve([]);
    await expect(pending).resolves.toEqual([]);
    expect(destroyed).toEqual(["/repo/a"]);
  });

  test("destroys a released finder after its in-flight search rejects", async () => {
    const destroyed: string[] = [];
    const fileSearch = createClaudeWorkspaceFileSearch({
      createFinder: () => ({
        search: async () => {
          throw new Error("search failed");
        },
        destroy: () => {
          destroyed.push("/repo/a");
        },
      }),
    });

    const pending = searchFiles(fileSearch, "/repo/a", "index");
    fileSearch.release("/repo/a");

    await expect(pending).rejects.toThrow("search failed");
    expect(destroyed).toEqual(["/repo/a"]);
  });

  test("reports a load failure when the finder cannot be created", async () => {
    const fileSearch = createClaudeWorkspaceFileSearch({
      createFinder: () => {
        throw new Error("fff native library not found");
      },
    });

    expect(() => fileSearch.prewarm("/repo/a")).toThrow("fff native library not found");
    await expect(searchFiles(fileSearch, "/repo/a", "index")).rejects.toThrow(
      "fff native library not found",
    );
  });
});

describe("trackClaudeFileSearchSessions", () => {
  const createSessionStore = (
    workingDirectories: string[],
  ): ClaudeFileSearchSessionStore & { close(index: number): void } => {
    const listeners = new Set<(session: ClaudeSession) => void>();
    // SAFETY: The tracker reads only input.workingDirectory from each session.
    const live = workingDirectories.map((workingDirectory) => ({
      input: { workingDirectory },
    })) as ClaudeSession[];
    return {
      subscribeClose: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      values: () => live.values(),
      close: (index) => {
        const [session] = live.splice(index, 1);
        if (!session) {
          throw new Error(`No session at index ${index}.`);
        }
        for (const listener of listeners) {
          listener(session);
        }
      },
    };
  };

  test("releases a finder when the last session for its directory closes", () => {
    const { createFinder, created, destroyed } = createFinderFactory();
    const fileSearch = createClaudeWorkspaceFileSearch({ createFinder });
    const sessionStore = createSessionStore(["/repo/a", "/repo/a"]);

    trackClaudeFileSearchSessions({ fileSearch, sessionStore });
    fileSearch.prewarm("/repo/a");
    sessionStore.close(0);
    expect(destroyed).toEqual([]);

    sessionStore.close(0);

    expect(created).toEqual(["/repo/a"]);
    expect(destroyed).toEqual(["/repo/a"]);
  });

  test("releases only the finder of the closed session directory", () => {
    const { createFinder, destroyed } = createFinderFactory();
    const fileSearch = createClaudeWorkspaceFileSearch({ createFinder });
    const sessionStore = createSessionStore(["/repo/a", "/repo/b"]);

    trackClaudeFileSearchSessions({ fileSearch, sessionStore });
    fileSearch.prewarm("/repo/a");
    fileSearch.prewarm("/repo/b");
    sessionStore.close(1);

    expect(destroyed).toEqual(["/repo/b"]);
  });
});

describe("waitForClaudeFileScan", () => {
  test("resolves when the scan completes", async () => {
    await expect(
      waitForClaudeFileScan({ waitForScan: async () => ({ ok: true, value: true }) }, "/repo/a"),
    ).resolves.toBeUndefined();
  });

  test("reports a timeout while the index still scans", async () => {
    await expect(
      waitForClaudeFileScan({ waitForScan: async () => ({ ok: true, value: false }) }, "/repo/a"),
    ).rejects.toThrow("still indexing '/repo/a'");
  });

  test("reports a scan failure", async () => {
    await expect(
      waitForClaudeFileScan(
        { waitForScan: async () => ({ ok: false, error: "native scan failed" }) },
        "/repo/a",
      ),
    ).rejects.toThrow("native scan failed");
  });
});

describe("createNativeClaudeFileFinder", () => {
  const createGitWorkspace = async (): Promise<string> => {
    const workspace = await createTempDirectory();
    await writeFile(join(workspace, ".gitignore"), "ignored.log\n");
    await mkdir(join(workspace, "empty-dir"));
    await writeFile(join(workspace, "tracked.ts"), "export const tracked = 1;\n");
    await writeFile(join(workspace, "untracked.ts"), "export const untracked = 1;\n");
    await writeFile(join(workspace, "ignored.log"), "secret\n");
    execFileSync("git", ["init", "-q"], { cwd: workspace });
    execFileSync("git", ["add", "tracked.ts", ".gitignore"], { cwd: workspace });
    return workspace;
  };

  test("finds files, empty folders, and untracked files while hiding ignored files", async () => {
    const workspace = await createGitWorkspace();
    const finder = createNativeClaudeFileFinder(workspace);
    try {
      const paths = async (query: string): Promise<string[]> =>
        (await finder.search(query)).map((result) => result.path);

      expect(await paths("untracked.ts")).toContain("untracked.ts");
      expect(await paths("empty-dir")).toContain("empty-dir");
      expect(await paths("ignored")).not.toContain("ignored.log");
    } finally {
      finder.destroy();
    }
  });

  test("returns initial candidates for an empty query", async () => {
    const workspace = await createGitWorkspace();
    const finder = createNativeClaudeFileFinder(workspace);
    try {
      const paths = (await finder.search("")).map((result) => result.path);

      expect(paths).toContain("tracked.ts");
      expect(paths).toContain("untracked.ts");
    } finally {
      finder.destroy();
    }
  });

  test("returns no results for a missing match", async () => {
    const workspace = await createGitWorkspace();
    const finder = createNativeClaudeFileFinder(workspace);
    try {
      await expect(finder.search("does-not-exist-anywhere")).resolves.toEqual([]);
    } finally {
      finder.destroy();
    }
  });
});
