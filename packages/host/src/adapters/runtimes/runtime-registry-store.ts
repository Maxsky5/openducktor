import type { RuntimeInstanceSummary } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { runtimeWorkspaceKey } from "../../domain/runtime-workspace-key";
import { HostOperationError } from "../../effect/host-errors";

export type WorkspaceRuntimeLookupInput = {
  runtimeKind: string;
  repoPath: string;
};

export type RuntimeRegistryStore = {
  upsert(runtime: RuntimeInstanceSummary): void;
  remove(runtimeId: string): RuntimeInstanceSummary | null;
  get(runtimeId: string): RuntimeInstanceSummary | null;
  list(): RuntimeInstanceSummary[];
  listByRepo(input: { repoPath: string; runtimeKind?: string }): RuntimeInstanceSummary[];
  findWorkspaceRuntime(
    input: WorkspaceRuntimeLookupInput,
  ): Effect.Effect<RuntimeInstanceSummary | null, HostOperationError>;
};

export const createRuntimeRegistryStore = (
  runtimes: Iterable<RuntimeInstanceSummary> = [],
): RuntimeRegistryStore => {
  const entries = new Map<string, RuntimeInstanceSummary>();
  const workspaceRuntimeIds = new Map<string, Set<string>>();

  const deleteWorkspaceRuntimeId = (runtimeId: string): void => {
    for (const [key, runtimeIds] of workspaceRuntimeIds) {
      runtimeIds.delete(runtimeId);
      if (runtimeIds.size === 0) {
        workspaceRuntimeIds.delete(key);
      }
    }
  };

  const upsert = (runtime: RuntimeInstanceSummary): void => {
    deleteWorkspaceRuntimeId(runtime.runtimeId);
    entries.set(runtime.runtimeId, runtime);
    if (runtime.role !== "workspace" || runtime.taskId !== null) {
      return;
    }

    const key = runtimeWorkspaceKey({ runtimeKind: runtime.kind, repoPath: runtime.repoPath });
    const runtimeIds = workspaceRuntimeIds.get(key) ?? new Set<string>();
    runtimeIds.add(runtime.runtimeId);
    workspaceRuntimeIds.set(key, runtimeIds);
  };

  for (const runtime of runtimes) {
    upsert(runtime);
  }

  return {
    upsert,
    remove(runtimeId) {
      const runtime = entries.get(runtimeId);
      if (!runtime) {
        return null;
      }
      entries.delete(runtimeId);
      deleteWorkspaceRuntimeId(runtimeId);
      return runtime;
    },
    get(runtimeId) {
      return entries.get(runtimeId) ?? null;
    },
    list() {
      return [...entries.values()];
    },
    listByRepo({ repoPath, runtimeKind }) {
      const normalizedRepoPath = normalizePathForComparison(repoPath);
      return [...entries.values()].filter((runtime) => {
        if (normalizePathForComparison(runtime.repoPath) !== normalizedRepoPath) {
          return false;
        }
        return !runtimeKind || runtime.kind === runtimeKind;
      });
    },
    findWorkspaceRuntime(input) {
      const key = runtimeWorkspaceKey(input);
      const runtimeIds = workspaceRuntimeIds.get(key) ?? new Set<string>();
      if (runtimeIds.size === 0) {
        return Effect.succeed(null);
      }
      if (runtimeIds.size > 1) {
        return Effect.fail(
          new HostOperationError({
            operation: "runtimeRegistry.findWorkspaceRuntime",
            message: `Multiple live ${input.runtimeKind} workspace runtimes found for repo '${input.repoPath}'.`,
            details: {
              runtimeKind: input.runtimeKind,
              repoPath: input.repoPath,
              runtimeIds: [...runtimeIds],
            },
          }),
        );
      }
      const runtimeId = [...runtimeIds][0];
      return Effect.succeed(runtimeId ? (entries.get(runtimeId) ?? null) : null);
    },
  };
};
