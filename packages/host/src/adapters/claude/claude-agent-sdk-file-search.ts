import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { sep } from "node:path";
import type { DirItem, FileFinder, FileItem, MixedSearchResult } from "@ff-labs/fff-node";
import {
  type AgentFileSearchResult,
  detectAgentFileReferenceKind,
  type SearchAgentFilesInput,
} from "@openducktor/core";
import { normalizePathSeparators } from "@openducktor/path-support";
import type { ClaudeSessionStore } from "./claude-agent-sdk-types";

export const FILE_SEARCH_LIMIT = 30;
const FILE_FINDER_CACHE_LIMIT = 3;
const FILE_FINDER_SCAN_TIMEOUT_MS = 5_000;
const ASAR_SEGMENT = `${sep}app.asar${sep}`;

export type ClaudeWorkspaceFileFinder = {
  search(query: string): Promise<AgentFileSearchResult[]>;
  destroy(): void;
};

export type ClaudeWorkspaceFileSearch = {
  prewarm(workingDirectory: string): void;
  release(workingDirectory: string): void;
  search(input: SearchAgentFilesInput): Promise<AgentFileSearchResult[]>;
};

type CachedClaudeFileFinder = {
  finder: ClaudeWorkspaceFileFinder;
  released: boolean;
  searchesInFlight: number;
};

export type ClaudeFileSearchSessionStore = Pick<ClaudeSessionStore, "subscribeClose" | "values">;

export const trackClaudeFileSearchSessions = ({
  fileSearch,
  sessionStore,
}: {
  fileSearch: ClaudeWorkspaceFileSearch;
  sessionStore: ClaudeFileSearchSessionStore;
}): void => {
  sessionStore.subscribeClose((session) => {
    const workingDirectory = session.input.workingDirectory;
    const inUse = [...sessionStore.values()].some(
      (other) => other.input.workingDirectory === workingDirectory,
    );
    if (!inUse) {
      fileSearch.release(workingDirectory);
    }
  });
};

export const toClaudeFileSearchResults = (result: MixedSearchResult): AgentFileSearchResult[] =>
  result.items
    .map((entry) =>
      entry.type === "directory" ? toDirectoryResult(entry.item) : toFileResult(entry.item),
    )
    .filter((entry) => entry.path.length > 0)
    .slice(0, FILE_SEARCH_LIMIT);

const toFileResult = (item: FileItem): AgentFileSearchResult => {
  const path = normalizePathSeparators(item.relativePath);
  return {
    id: path,
    path,
    name: item.fileName,
    kind: detectAgentFileReferenceKind({ filePath: path }),
  };
};

const toDirectoryResult = (item: DirItem): AgentFileSearchResult => {
  const path = normalizePathSeparators(item.relativePath);
  return {
    id: path,
    path,
    name: item.dirName.replace(/[\\/]+$/u, ""),
    kind: "directory",
  };
};

export const resolveUnpackedAsarModulePath = (modulePath: string): string => {
  if (!modulePath.includes(ASAR_SEGMENT)) {
    return modulePath;
  }
  const unpackedPath = modulePath.replace(ASAR_SEGMENT, `${sep}app.asar.unpacked${sep}`);
  return existsSync(unpackedPath) ? unpackedPath : modulePath;
};

const loadFileFinderModule = (): typeof import("@ff-labs/fff-node") => {
  // fff loads its native library next to the package. ffi-rs cannot open that
  // path inside an Electron asar archive, so load the unpacked copy.
  const require = createRequire(import.meta.url);
  const modulePath = resolveUnpackedAsarModulePath(require.resolve("@ff-labs/fff-node"));
  // SAFETY: The resolved path is the CommonJS entry of @ff-labs/fff-node, so the
  // loaded value has the package API type.
  return require(modulePath) as typeof import("@ff-labs/fff-node");
};

export const waitForClaudeFileScan = async (
  finder: Pick<FileFinder, "waitForScan">,
  workingDirectory: string,
): Promise<void> => {
  const completed = await finder.waitForScan(FILE_FINDER_SCAN_TIMEOUT_MS);
  if (!completed.ok) {
    throw new Error(`Claude file search could not index '${workingDirectory}': ${completed.error}`);
  }
  if (!completed.value) {
    throw new Error(
      `Claude file search is still indexing '${workingDirectory}'. Search again after indexing finishes.`,
    );
  }
};

export const createNativeClaudeFileFinder = (
  workingDirectory: string,
): ClaudeWorkspaceFileFinder => {
  const { FileFinder } = loadFileFinderModule();
  const created = FileFinder.create({ basePath: workingDirectory });
  if (!created.ok) {
    throw new Error(`Claude file search could not index '${workingDirectory}': ${created.error}`);
  }
  const finder = created.value;
  return {
    search: async (query) => {
      await waitForClaudeFileScan(finder, workingDirectory);
      const result = finder.mixedSearch(query, { pageSize: FILE_SEARCH_LIMIT });
      if (!result.ok) {
        throw new Error(`Claude file search failed in '${workingDirectory}': ${result.error}`);
      }
      return toClaudeFileSearchResults(result.value);
    },
    destroy: () => finder.destroy(),
  };
};

export const createClaudeWorkspaceFileSearch = ({
  createFinder = createNativeClaudeFileFinder,
  cacheLimit = FILE_FINDER_CACHE_LIMIT,
}: {
  createFinder?: (workingDirectory: string) => ClaudeWorkspaceFileFinder;
  cacheLimit?: number;
} = {}): ClaudeWorkspaceFileSearch => {
  const findersByDirectory = new Map<string, CachedClaudeFileFinder>();

  const destroyCachedFinder = (cached: CachedClaudeFileFinder): void => {
    if (cached.searchesInFlight > 0) {
      cached.released = true;
      return;
    }
    cached.finder.destroy();
  };

  const destroyEvictedFinders = (): void => {
    while (findersByDirectory.size > cacheLimit) {
      const oldest = findersByDirectory.entries().next().value;
      if (!oldest) {
        return;
      }
      const [workingDirectory, cached] = oldest;
      findersByDirectory.delete(workingDirectory);
      destroyCachedFinder(cached);
    }
  };

  const ensureFinder = (workingDirectory: string): CachedClaudeFileFinder => {
    const existing = findersByDirectory.get(workingDirectory);
    if (existing) {
      findersByDirectory.delete(workingDirectory);
      findersByDirectory.set(workingDirectory, existing);
      return existing;
    }
    const cached: CachedClaudeFileFinder = {
      finder: createFinder(workingDirectory),
      released: false,
      searchesInFlight: 0,
    };
    findersByDirectory.set(workingDirectory, cached);
    destroyEvictedFinders();
    return cached;
  };

  return {
    prewarm: (workingDirectory) => {
      try {
        ensureFinder(workingDirectory);
      } catch {
        // A failed prewarm stays silent so the session opens. The '@' search
        // reports the load failure when the composer requests results.
      }
    },
    release: (workingDirectory) => {
      const cached = findersByDirectory.get(workingDirectory);
      if (!cached) {
        return;
      }
      findersByDirectory.delete(workingDirectory);
      destroyCachedFinder(cached);
    },
    search: async (input) => {
      const cached = ensureFinder(input.workingDirectory);
      cached.searchesInFlight += 1;
      try {
        return await cached.finder.search(input.query);
      } finally {
        cached.searchesInFlight -= 1;
        if (cached.released && cached.searchesInFlight === 0) {
          cached.finder.destroy();
        }
      }
    },
  };
};
