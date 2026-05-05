import type { RepoRuntimeRef, RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort, LiveSessionTruth } from "@openducktor/core";
import { normalizeWorkingDirectory } from "../support/core";

export const getLiveAgentSessionCacheKey = (repoPath: string, runtimeKind: RuntimeKind): string =>
  `${normalizeWorkingDirectory(repoPath)}::${runtimeKind}`;

export const liveAgentSessionLookupKey = (
  repoPath: string,
  runtimeKind: RuntimeKind,
  workingDirectory: string,
): string =>
  `${getLiveAgentSessionCacheKey(repoPath, runtimeKind)}::${normalizeWorkingDirectory(workingDirectory)}`;

type LiveAgentSessionScanner = Pick<AgentEnginePort, "listLiveSessionTruths">;

export class LiveAgentSessionCache {
  private readonly scansByKey = new Map<string, LiveSessionTruth[]>();
  private readonly inFlightScansByKey = new Map<string, Promise<LiveSessionTruth[]>>();

  constructor(
    private readonly adapter: LiveAgentSessionScanner,
    private readonly preloadedByKey?: Map<string, LiveSessionTruth[]>,
  ) {}

  async load(
    input: RepoRuntimeRef & {
      directories: string[];
    },
  ): Promise<LiveSessionTruth[]> {
    const normalizedDirectories = Array.from(
      new Set(
        input.directories
          .map((directory) => normalizeWorkingDirectory(directory))
          .filter((directory) => directory.length > 0),
      ),
    ).sort();
    if (input.directories.length > 0 && normalizedDirectories.length === 0) {
      throw new Error("Cannot scan live agent sessions without a valid working directory.");
    }
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

    const inFlightScan = this.inFlightScansByKey.get(key);
    if (inFlightScan) {
      return inFlightScan;
    }

    const scan = this.adapter
      .listLiveSessionTruths({
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
        ...(normalizedDirectories.length > 0 ? { directories: normalizedDirectories } : {}),
      })
      .then((sessions) => {
        this.scansByKey.set(key, sessions);
        return sessions;
      })
      .finally(() => {
        this.inFlightScansByKey.delete(key);
      });
    this.inFlightScansByKey.set(key, scan);
    return scan;
  }
}
