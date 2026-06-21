import type { RuntimeInstanceSummary } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
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

  const upsert = (runtime: RuntimeInstanceSummary): void => {
    entries.set(runtime.runtimeId, runtime);
  };

  for (const runtime of runtimes) {
    upsert(runtime);
  }

  const listByRepo = ({
    repoPath,
    runtimeKind,
  }: {
    repoPath: string;
    runtimeKind?: string;
  }): RuntimeInstanceSummary[] => {
    const normalizedRepoPath = normalizePathForComparison(repoPath);
    return [...entries.values()].filter(
      (runtime) =>
        normalizePathForComparison(runtime.repoPath) === normalizedRepoPath &&
        (runtimeKind === undefined || runtime.kind === runtimeKind),
    );
  };

  const isWorkspaceRuntime = (runtime: RuntimeInstanceSummary): boolean =>
    runtime.role === "workspace" && runtime.taskId === null;

  return {
    upsert,
    remove(runtimeId) {
      const runtime = entries.get(runtimeId);
      if (!runtime) {
        return null;
      }
      entries.delete(runtimeId);
      return runtime;
    },
    get(runtimeId) {
      return entries.get(runtimeId) ?? null;
    },
    list() {
      return [...entries.values()];
    },
    listByRepo,
    findWorkspaceRuntime(input) {
      const matches = listByRepo(input).filter(isWorkspaceRuntime);
      if (matches.length === 0) {
        return Effect.succeed(null);
      }
      if (matches.length > 1) {
        return Effect.fail(
          new HostOperationError({
            operation: "runtimeRegistry.findWorkspaceRuntime",
            message: `Multiple live ${input.runtimeKind} workspace runtimes found for repo '${input.repoPath}'.`,
            details: {
              runtimeKind: input.runtimeKind,
              repoPath: input.repoPath,
              runtimeIds: matches.map((runtime) => runtime.runtimeId),
            },
          }),
        );
      }
      return Effect.succeed(matches[0] ?? null);
    },
  };
};
