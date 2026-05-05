import type {
  AgentSessionRecord,
  RuntimeInstanceSummary,
  RuntimeKind,
} from "@openducktor/contracts";
import type { AgentEnginePort, AgentSessionPresenceSnapshot } from "@openducktor/core";
import { normalizeWorkingDirectory } from "../support/core";
import { readPersistedRuntimeKind } from "../support/session-runtime-metadata";
import { findRepoRuntime } from "./hydration-runtime-resolution";
import { agentSessionPresenceLookupKey } from "./session-presence-cache";

export type RepoSessionPresencePreloads = {
  preloadedRuntimeLists: Map<RuntimeKind, RuntimeInstanceSummary[]>;
  preloadedSessionPresenceByKey: Map<string, AgentSessionPresenceSnapshot[]>;
};

export type PrepareRepoSessionPresencePreloadsInput = {
  repoPath: string;
  records: AgentSessionRecord[];
  loadRuntimeList: (
    runtimeKind: RuntimeKind,
    repoPath: string,
  ) => Promise<RuntimeInstanceSummary[]>;
  listSessionPresence: AgentEnginePort["listSessionPresence"];
};

export const prepareRepoSessionPresencePreloads = async ({
  repoPath,
  records,
  loadRuntimeList,
  listSessionPresence,
}: PrepareRepoSessionPresencePreloadsInput): Promise<RepoSessionPresencePreloads> => {
  const directoriesByRuntimeKind = new Map<RuntimeKind, Set<string>>();
  for (const record of records) {
    const runtimeKind = readPersistedRuntimeKind(record);
    const normalizedDirectory = normalizeWorkingDirectory(record.workingDirectory);
    if (normalizedDirectory.length === 0) {
      continue;
    }
    const directories = directoriesByRuntimeKind.get(runtimeKind) ?? new Set<string>();
    directories.add(normalizedDirectory);
    directoriesByRuntimeKind.set(runtimeKind, directories);
  }

  const runtimeKinds = Array.from(directoriesByRuntimeKind.keys()).sort();
  const preloadedRuntimeLists = new Map<RuntimeKind, RuntimeInstanceSummary[]>(
    await Promise.all(
      runtimeKinds.map(async (runtimeKind) => {
        const runtimes = await loadRuntimeList(runtimeKind, repoPath);
        return [runtimeKind, runtimes] as const;
      }),
    ),
  );
  const preloadedSessionPresenceByKey = new Map<string, AgentSessionPresenceSnapshot[]>();

  await Promise.all(
    runtimeKinds.map(async (runtimeKind) => {
      const directories = Array.from(directoriesByRuntimeKind.get(runtimeKind) ?? []).sort();
      const repoRuntime = findRepoRuntime({
        repoPath,
        runtimeKind,
        runtimes: preloadedRuntimeLists.get(runtimeKind) ?? [],
      });
      if (!repoRuntime) {
        return;
      }

      const requestedDirectoryKeys = new Set<string>();
      for (const directory of directories) {
        const lookupKey = agentSessionPresenceLookupKey(repoPath, runtimeKind, directory);
        requestedDirectoryKeys.add(lookupKey);
        preloadedSessionPresenceByKey.set(lookupKey, []);
      }

      const snapshots = await listSessionPresence({ repoPath, runtimeKind, directories });
      for (const snapshot of snapshots) {
        if (snapshot.presence !== "runtime") {
          continue;
        }
        const lookupKey = agentSessionPresenceLookupKey(
          repoPath,
          runtimeKind,
          snapshot.ref.workingDirectory,
        );
        if (!requestedDirectoryKeys.has(lookupKey)) {
          continue;
        }
        preloadedSessionPresenceByKey.set(lookupKey, [
          ...(preloadedSessionPresenceByKey.get(lookupKey) ?? []),
          snapshot,
        ]);
      }
    }),
  );

  return { preloadedRuntimeLists, preloadedSessionPresenceByKey };
};
