import type { RuntimeKind } from "@openducktor/contracts";
import {
  classifyRepoRuntimeHealth,
  describeRepoRuntimeStatus,
  type RepoRuntimeHealthReadiness,
} from "@/lib/repo-runtime-health";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";
import { toPersistedSessionIdentity } from "../support/persistence";
import type { TaskSessionRecords } from "./task-session-records";

export type SessionRuntimeReadiness =
  | { kind: "ready" }
  | { kind: "waiting_for_runtime" }
  | { kind: "blocked"; message: string };

const collectRuntimeKinds = (tasks: TaskSessionRecords): RuntimeKind[] => {
  const runtimeKinds = new Set<RuntimeKind>();
  for (const { record } of tasks.records) {
    runtimeKinds.add(toPersistedSessionIdentity(record).runtimeKind);
  }
  return Array.from(runtimeKinds).sort();
};

const toSessionRuntimeReadinessKind = (
  readiness: RepoRuntimeHealthReadiness,
): "ready" | "waiting" | "blocked" => {
  switch (readiness) {
    case "ready":
      return "ready";
    case "blocked":
      return "blocked";
    case "unknown":
    case "startup_pending":
    case "checking":
      return "waiting";
  }
};

export const deriveSessionRuntimeReadiness = ({
  tasks,
  runtimeHealthByRuntime,
}: {
  tasks: TaskSessionRecords;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
}): SessionRuntimeReadiness => {
  for (const runtimeKind of collectRuntimeKinds(tasks)) {
    const runtimeHealth = runtimeHealthByRuntime[runtimeKind] ?? null;
    switch (toSessionRuntimeReadinessKind(classifyRepoRuntimeHealth(runtimeHealth))) {
      case "ready":
        continue;
      case "waiting":
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
