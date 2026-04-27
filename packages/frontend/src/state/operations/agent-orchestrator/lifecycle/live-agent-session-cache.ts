import type { RuntimeKind } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentRuntimeConnection,
  LiveAgentSessionSnapshot,
} from "@openducktor/core";
import { runtimeConnectionTransportKey } from "../runtime/runtime";
import { normalizeWorkingDirectory } from "../support/core";

export const getLiveAgentSessionCacheKey = (
  runtimeKind: string,
  runtimeConnection: AgentRuntimeConnection,
): string => {
  const connectionKey =
    runtimeConnection.type === "stdio"
      ? `${runtimeConnectionTransportKey(runtimeConnection)}::${normalizeWorkingDirectory(runtimeConnection.workingDirectory)}`
      : runtimeConnectionTransportKey(runtimeConnection);
  return `${runtimeKind}::${connectionKey}`;
};

export const runtimeWorkingDirectoryKey = (runtimeKind: string, workingDirectory: string): string =>
  `${runtimeKind}::${normalizeWorkingDirectory(workingDirectory)}`;

const runtimeConnectionPreloadKey = (
  runtimeKind: string,
  runtimeConnection: AgentRuntimeConnection,
): string =>
  `${runtimeKind}::${runtimeConnectionTransportKey(runtimeConnection)}::${normalizeWorkingDirectory(
    runtimeConnection.workingDirectory,
  )}`;

export class RuntimeConnectionPreloadIndex {
  private readonly connectionsByKey = new Map<string, AgentRuntimeConnection>();

  get size(): number {
    return this.connectionsByKey.size;
  }

  add(runtimeKind: RuntimeKind, runtimeConnection: AgentRuntimeConnection): void {
    this.connectionsByKey.set(
      runtimeConnectionPreloadKey(runtimeKind, runtimeConnection),
      runtimeConnection,
    );
  }

  hasAny(runtimeKind: RuntimeKind, workingDirectory: string): boolean {
    return this.findCandidates(runtimeKind, workingDirectory).length > 0;
  }

  findCandidates(runtimeKind: RuntimeKind, workingDirectory: string): AgentRuntimeConnection[] {
    const runtimeKindPrefix = `${runtimeKind}::`;
    const normalizedWorkingDirectory = normalizeWorkingDirectory(workingDirectory);

    return Array.from(this.connectionsByKey.entries())
      .filter(
        ([key, runtimeConnection]) =>
          key.startsWith(runtimeKindPrefix) &&
          normalizeWorkingDirectory(runtimeConnection.workingDirectory) ===
            normalizedWorkingDirectory,
      )
      .map(([, runtimeConnection]) => runtimeConnection);
  }
}

export const liveAgentSessionLookupKey = (
  runtimeKind: string,
  runtimeConnection: AgentRuntimeConnection,
  workingDirectory: string,
): string =>
  `${getLiveAgentSessionCacheKey(runtimeKind, runtimeConnection)}::${normalizeWorkingDirectory(workingDirectory)}`;

type LiveAgentSessionScanner = Pick<AgentEnginePort, "listLiveAgentSessionSnapshots">;

export class LiveAgentSessionCache {
  private readonly scansByKey = new Map<string, LiveAgentSessionSnapshot[]>();

  constructor(
    private readonly adapter: LiveAgentSessionScanner,
    private readonly preloadedByKey?: Map<string, LiveAgentSessionSnapshot[]>,
  ) {}

  async load(input: {
    runtimeKind: RuntimeKind;
    runtimeConnection: AgentRuntimeConnection;
    directories: string[];
  }): Promise<LiveAgentSessionSnapshot[]> {
    const normalizedDirectories = Array.from(
      new Set(
        input.directories
          .map((directory) => normalizeWorkingDirectory(directory))
          .filter((directory) => directory.length > 0),
      ),
    ).sort();
    const key = `${getLiveAgentSessionCacheKey(input.runtimeKind, input.runtimeConnection)}::${normalizedDirectories.join("|")}`;
    const cached = this.scansByKey.get(key);
    if (cached) {
      return cached;
    }

    const [singleDirectory] = normalizedDirectories;
    if (singleDirectory && this.preloadedByKey) {
      const preloaded = this.preloadedByKey.get(
        liveAgentSessionLookupKey(input.runtimeKind, input.runtimeConnection, singleDirectory),
      );
      if (preloaded) {
        this.scansByKey.set(key, preloaded);
        return preloaded;
      }
    }

    const sessions = await this.adapter.listLiveAgentSessionSnapshots({
      runtimeKind: input.runtimeKind,
      runtimeConnection: input.runtimeConnection,
      ...(normalizedDirectories.length > 0 ? { directories: normalizedDirectories } : {}),
    });
    this.scansByKey.set(key, sessions);
    return sessions;
  }
}
