import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort, AgentSessionPresenceSnapshot } from "@openducktor/core";
import { normalizeWorkingDirectory } from "../support/core";
import { readPersistedRuntimeKind } from "../support/session-runtime-metadata";
import { agentSessionPresenceLookupKey } from "./session-presence-cache";

export type RepoSessionPresencePreloads = {
  preloadedSessionPresenceByKey: Map<string, AgentSessionPresenceSnapshot[]>;
};

export type PrepareRepoSessionPresencePreloadsInput = {
  repoPath: string;
  records: AgentSessionRecord[];
  listSessionPresence: AgentEnginePort["listSessionPresence"];
};

export const prepareRepoSessionPresencePreloads = async ({
  repoPath,
  records,
  listSessionPresence,
}: PrepareRepoSessionPresencePreloadsInput): Promise<RepoSessionPresencePreloads> => {
  const directoriesByRuntimeKind = new Map<RuntimeKind, Set<string>>();
  for (const record of records) {
    const runtimeKind = readPersistedRuntimeKind(record);
    const directory = normalizeWorkingDirectory(record.workingDirectory);
    if (directory.length === 0) {
      continue;
    }
    const directories = directoriesByRuntimeKind.get(runtimeKind) ?? new Set<string>();
    directories.add(directory);
    directoriesByRuntimeKind.set(runtimeKind, directories);
  }

  const preloadedSessionPresenceByKey = new Map<string, AgentSessionPresenceSnapshot[]>();
  await Promise.all(
    Array.from(directoriesByRuntimeKind.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(async ([runtimeKind, directorySet]) => {
        const directories = Array.from(directorySet).sort();
        const requestedKeys = new Set<string>();
        for (const directory of directories) {
          const lookupKey = agentSessionPresenceLookupKey(repoPath, runtimeKind, directory);
          requestedKeys.add(lookupKey);
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
          if (!requestedKeys.has(lookupKey)) {
            continue;
          }
          preloadedSessionPresenceByKey.set(lookupKey, [
            ...(preloadedSessionPresenceByKey.get(lookupKey) ?? []),
            snapshot,
          ]);
        }
      }),
  );

  return { preloadedSessionPresenceByKey };
};
