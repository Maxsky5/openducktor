import type { RepoRuntimeRef, RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort, AgentSessionPresenceSnapshot } from "@openducktor/core";
import { normalizeWorkingDirectory } from "../support/core";

export const getAgentSessionPresenceCacheKey = (
  repoPath: string,
  runtimeKind: RuntimeKind,
): string => `${normalizeWorkingDirectory(repoPath)}::${runtimeKind}`;

export const agentSessionPresenceLookupKey = (
  repoPath: string,
  runtimeKind: RuntimeKind,
  workingDirectory: string,
): string =>
  `${getAgentSessionPresenceCacheKey(repoPath, runtimeKind)}::${normalizeWorkingDirectory(workingDirectory)}`;

type AgentSessionPresenceScanner = Pick<AgentEnginePort, "listSessionPresence">;

export class AgentSessionPresenceCache {
  private readonly scansByKey = new Map<string, AgentSessionPresenceSnapshot[]>();
  private readonly inFlightScansByKey = new Map<string, Promise<AgentSessionPresenceSnapshot[]>>();

  constructor(
    private readonly adapter: AgentSessionPresenceScanner,
    private readonly preloadedByKey?: Map<string, AgentSessionPresenceSnapshot[]>,
  ) {}

  async load(
    input: RepoRuntimeRef & {
      directories: string[];
    },
  ): Promise<AgentSessionPresenceSnapshot[]> {
    const uniqueDirectories = new Set<string>();
    for (const directory of input.directories) {
      const normalizedDirectory = normalizeWorkingDirectory(directory);
      if (normalizedDirectory.length > 0) {
        uniqueDirectories.add(normalizedDirectory);
      }
    }
    const normalizedDirectories = Array.from(uniqueDirectories).sort();
    if (input.directories.length > 0 && normalizedDirectories.length === 0) {
      throw new Error("Cannot scan session presence without a valid working directory.");
    }
    const key = `${getAgentSessionPresenceCacheKey(input.repoPath, input.runtimeKind)}::${normalizedDirectories.join("|")}`;
    const cached = this.scansByKey.get(key);
    if (cached) {
      return cached;
    }

    const [singleDirectory] = normalizedDirectories;
    if (singleDirectory && this.preloadedByKey) {
      const preloaded = this.preloadedByKey.get(
        agentSessionPresenceLookupKey(input.repoPath, input.runtimeKind, singleDirectory),
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
      .listSessionPresence({
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
