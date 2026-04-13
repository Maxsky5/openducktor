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
): string => `${runtimeKind}::${runtimeConnectionTransportKey(runtimeConnection)}`;

export const runtimeWorkingDirectoryKey = (runtimeKind: string, workingDirectory: string): string =>
  `${runtimeKind}::${normalizeWorkingDirectory(workingDirectory)}`;

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
