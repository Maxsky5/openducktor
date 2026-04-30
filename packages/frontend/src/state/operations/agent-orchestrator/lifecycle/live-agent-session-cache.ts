import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort, LiveAgentSessionSnapshot } from "@openducktor/core";
import { normalizeWorkingDirectory } from "../support/core";

export const getLiveAgentSessionCacheKey = (repoPath: string, runtimeKind: string): string =>
  `${normalizeWorkingDirectory(repoPath)}::${runtimeKind}`;

export const runtimeWorkingDirectoryKey = (
  repoPath: string,
  runtimeKind: string,
  workingDirectory: string,
): string =>
  `${getLiveAgentSessionCacheKey(repoPath, runtimeKind)}::${normalizeWorkingDirectory(workingDirectory)}`;

const runtimeWorktreePreloadKey = (
  repoPath: string,
  runtimeKind: string,
  workingDirectory: string,
): string => runtimeWorkingDirectoryKey(repoPath, runtimeKind, workingDirectory);

const runtimeWorktreePreloadDirectoryKey = (
  repoPath: string,
  runtimeKind: RuntimeKind,
  workingDirectory: string,
): string => runtimeWorkingDirectoryKey(repoPath, runtimeKind, workingDirectory);

export class RuntimeWorktreePreloadIndex {
  private readonly worktreesByKey = new Map<
    string,
    { repoPath: string; runtimeKind: RuntimeKind; workingDirectory: string }
  >();
  private readonly worktreesByDirectoryKey = new Map<
    string,
    Map<string, { repoPath: string; runtimeKind: RuntimeKind; workingDirectory: string }>
  >();

  get size(): number {
    return this.worktreesByKey.size;
  }

  add(repoPath: string, runtimeKind: RuntimeKind, workingDirectory: string): void {
    const worktree = { repoPath, runtimeKind, workingDirectory };
    const worktreeKey = runtimeWorktreePreloadKey(repoPath, runtimeKind, workingDirectory);
    this.worktreesByKey.set(worktreeKey, worktree);

    const directoryKey = runtimeWorktreePreloadDirectoryKey(
      repoPath,
      runtimeKind,
      workingDirectory,
    );
    const worktreesForDirectory =
      this.worktreesByDirectoryKey.get(directoryKey) ??
      new Map<string, { repoPath: string; runtimeKind: RuntimeKind; workingDirectory: string }>();
    worktreesForDirectory.set(worktreeKey, worktree);
    this.worktreesByDirectoryKey.set(directoryKey, worktreesForDirectory);
  }

  hasAny(repoPath: string, runtimeKind: RuntimeKind, workingDirectory: string): boolean {
    return this.worktreesByDirectoryKey.has(
      runtimeWorktreePreloadDirectoryKey(repoPath, runtimeKind, workingDirectory),
    );
  }

  findCandidates(repoPath: string, runtimeKind: RuntimeKind, workingDirectory: string) {
    return Array.from(
      this.worktreesByDirectoryKey
        .get(runtimeWorktreePreloadDirectoryKey(repoPath, runtimeKind, workingDirectory))
        ?.values() ?? [],
    );
  }
}

export const liveAgentSessionLookupKey = (
  repoPath: string,
  runtimeKind: string,
  workingDirectory: string,
): string =>
  `${getLiveAgentSessionCacheKey(repoPath, runtimeKind)}::${normalizeWorkingDirectory(workingDirectory)}`;

type LiveAgentSessionScanner = Pick<AgentEnginePort, "listLiveAgentSessionSnapshots">;

export class LiveAgentSessionCache {
  private readonly scansByKey = new Map<string, LiveAgentSessionSnapshot[]>();

  constructor(
    private readonly adapter: LiveAgentSessionScanner,
    private readonly preloadedByKey?: Map<string, LiveAgentSessionSnapshot[]>,
  ) {}

  async load(input: {
    repoPath: string;
    runtimeKind: RuntimeKind;
    directories: string[];
  }): Promise<LiveAgentSessionSnapshot[]> {
    const normalizedDirectories = Array.from(
      new Set(
        input.directories
          .map((directory) => normalizeWorkingDirectory(directory))
          .filter((directory) => directory.length > 0),
      ),
    ).sort();
    const key = `${getLiveAgentSessionCacheKey(input.repoPath, input.runtimeKind)}::${normalizedDirectories.join("|")}`;
    const cached = this.scansByKey.get(key);
    if (cached) {
      return cached;
    }

    const [singleDirectory] = normalizedDirectories;
    if (singleDirectory && this.preloadedByKey) {
      const preloaded = this.preloadedByKey.get(
        liveAgentSessionLookupKey(input.repoPath, input.runtimeKind, singleDirectory),
      );
      if (preloaded) {
        this.scansByKey.set(key, preloaded);
        return preloaded;
      }
    }

    const sessions = await this.adapter.listLiveAgentSessionSnapshots({
      repoPath: input.repoPath,
      runtimeKind: input.runtimeKind,
      ...(normalizedDirectories.length > 0 ? { directories: normalizedDirectories } : {}),
    });
    this.scansByKey.set(key, sessions);
    return sessions;
  }
}
