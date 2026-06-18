import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import { toPersistedSessionIdentity } from "../support/persistence";
import type { AgentSessionRuntimeSnapshot } from "./session-runtime-snapshot";
import { collectTaskSessionRecords, type TaskSessionRecords } from "./task-session-records";

export type RepoRuntimeSessionSnapshots = Map<string, AgentSessionRuntimeSnapshot>;

export const readRepoRuntimeSessionSnapshots = async ({
  repoPath,
  tasks,
  listSessionRuntimeSnapshots,
}: {
  repoPath: string;
  tasks: TaskSessionRecords[];
  listSessionRuntimeSnapshots: AgentEnginePort["listSessionRuntimeSnapshots"];
}): Promise<RepoRuntimeSessionSnapshots> => {
  const taskSessionRecords = collectTaskSessionRecords(tasks);
  const directoriesByRuntimeKind = new Map<RuntimeKind, Set<string>>();
  for (const { record } of taskSessionRecords) {
    const identity = toPersistedSessionIdentity(record);
    const runtimeKind = identity.runtimeKind;
    const directory = normalizeWorkingDirectory(identity.workingDirectory);
    const directories = directoriesByRuntimeKind.get(runtimeKind) ?? new Set<string>();
    directories.add(directory);
    directoriesByRuntimeKind.set(runtimeKind, directories);
  }

  const snapshotsBySessionKey = new Map<string, AgentSessionRuntimeSnapshot>();
  await Promise.all(
    Array.from(directoriesByRuntimeKind.entries()).map(async ([runtimeKind, directorySet]) => {
      const directories = Array.from(directorySet).sort();
      const snapshots = await listSessionRuntimeSnapshots({ repoPath, runtimeKind, directories });
      for (const snapshot of snapshots) {
        if (
          snapshot.ref.runtimeKind !== runtimeKind ||
          !directorySet.has(normalizeWorkingDirectory(snapshot.ref.workingDirectory))
        ) {
          continue;
        }
        snapshotsBySessionKey.set(agentSessionIdentityKey(snapshot.ref), snapshot);
      }
    }),
  );

  return snapshotsBySessionKey;
};
