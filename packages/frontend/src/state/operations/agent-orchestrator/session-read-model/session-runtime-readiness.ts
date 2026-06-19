import type { RuntimeKind } from "@openducktor/contracts";
import { classifyRepoRuntimeHealth, describeRepoRuntimeStatus } from "@/lib/repo-runtime-health";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";
import { toPersistedSessionIdentity } from "../support/persistence";
import type { TaskSessionRecords } from "./task-session-records";

type SessionRuntimeReadiness =
  | { kind: "ready" }
  | { kind: "waiting_for_runtime" }
  | { kind: "blocked"; message: string };

const READINESS_KEY_SEPARATOR = "\u001f";

const collectRuntimeKinds = (tasks: TaskSessionRecords): RuntimeKind[] => {
  const runtimeKinds = new Set<RuntimeKind>();
  for (const { record } of tasks.records) {
    runtimeKinds.add(toPersistedSessionIdentity(record).runtimeKind);
  }
  return Array.from(runtimeKinds).sort();
};

const runtimeReadinessKeyPart = (
  runtimeKind: string,
  runtimeHealth: RepoRuntimeHealthMap[string],
): string => {
  switch (classifyRepoRuntimeHealth(runtimeHealth)) {
    case "ready":
      return `${runtimeKind}:ready`;
    case "unknown":
    case "startup_pending":
    case "checking":
      return `${runtimeKind}:waiting`;
    case "blocked":
      return `${runtimeKind}:blocked`;
  }
};

export const sessionRuntimeReadinessKey = (runtimeHealthByRuntime: RepoRuntimeHealthMap): string =>
  Object.keys(runtimeHealthByRuntime)
    .sort()
    .map((runtimeKind) =>
      runtimeReadinessKeyPart(runtimeKind, runtimeHealthByRuntime[runtimeKind] ?? null),
    )
    .join(READINESS_KEY_SEPARATOR);

export const deriveSessionRuntimeReadiness = ({
  tasks,
  runtimeHealthByRuntime,
}: {
  tasks: TaskSessionRecords;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
}): SessionRuntimeReadiness => {
  for (const runtimeKind of collectRuntimeKinds(tasks)) {
    const runtimeHealth = runtimeHealthByRuntime[runtimeKind] ?? null;
    switch (classifyRepoRuntimeHealth(runtimeHealth)) {
      case "ready":
        continue;
      case "unknown":
      case "startup_pending":
      case "checking":
        return { kind: "waiting_for_runtime" };
      case "blocked":
        return {
          kind: "blocked",
          message:
            describeRepoRuntimeStatus(runtimeKind, runtimeHealth) ??
            `Runtime '${runtimeKind}' is not ready to load session snapshots.`,
        };
    }
  }

  return { kind: "ready" };
};
