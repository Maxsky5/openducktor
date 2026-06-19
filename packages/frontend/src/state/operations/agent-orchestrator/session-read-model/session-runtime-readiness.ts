import type { RuntimeKind } from "@openducktor/contracts";
import {
  describeRepoRuntimeStatus,
  isRepoRuntimeReady,
  isRepoRuntimeStartupPending,
} from "@/lib/repo-runtime-health";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";
import { toPersistedSessionIdentity } from "../support/persistence";
import { collectTaskSessionRecords, type TaskSessionRecords } from "./task-session-records";

type SessionRuntimeReadiness =
  | { kind: "ready" }
  | { kind: "waiting_for_runtime" }
  | { kind: "blocked"; message: string };

const collectRuntimeKinds = (tasks: TaskSessionRecords[]): RuntimeKind[] => {
  const runtimeKinds = new Set<RuntimeKind>();
  for (const { record } of collectTaskSessionRecords(tasks)) {
    runtimeKinds.add(toPersistedSessionIdentity(record).runtimeKind);
  }
  return Array.from(runtimeKinds).sort();
};

export const deriveSessionRuntimeReadiness = ({
  tasks,
  runtimeHealthByRuntime,
}: {
  tasks: TaskSessionRecords[];
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
}): SessionRuntimeReadiness => {
  for (const runtimeKind of collectRuntimeKinds(tasks)) {
    const runtimeHealth = runtimeHealthByRuntime[runtimeKind] ?? null;
    if (isRepoRuntimeReady(runtimeHealth)) {
      continue;
    }
    if (!runtimeHealth || isRepoRuntimeStartupPending(runtimeHealth)) {
      return { kind: "waiting_for_runtime" };
    }

    return {
      kind: "blocked",
      message:
        describeRepoRuntimeStatus(runtimeKind, runtimeHealth) ??
        `Runtime '${runtimeKind}' is not ready to load session snapshots.`,
    };
  }

  return { kind: "ready" };
};
