import type {
  AgentSessionRecord,
  RuntimeInstanceSummary,
  RuntimeKind,
} from "@openducktor/contracts";
import { normalizeWorkingDirectory } from "../support/core";
import { readPersistedRuntimeKind } from "../support/session-runtime-metadata";

export type ResolvedHydrationRuntime =
  | {
      ok: true;
      runtimeKind: RuntimeKind;
      runtimeId: string | null;
      workingDirectory: string;
    }
  | {
      ok: false;
      runtimeKind: RuntimeKind;
      reason: string;
    };

export const createHydrationRuntimeResolver = ({
  repoPath,
  runtimesByKind,
}: {
  repoPath: string;
  runtimesByKind: Map<RuntimeKind, RuntimeInstanceSummary[]>;
}): ((record: AgentSessionRecord) => Promise<ResolvedHydrationRuntime>) => {
  const normalizedRepoPath = normalizeWorkingDirectory(repoPath);

  const findRepoRuntime = (runtimeKind: RuntimeKind): RuntimeInstanceSummary | null => {
    const runtimes = runtimesByKind.get(runtimeKind) ?? [];
    return (
      runtimes.find(
        (runtime) =>
          runtime.kind === runtimeKind &&
          normalizeWorkingDirectory(runtime.repoPath) === normalizedRepoPath,
      ) ?? null
    );
  };

  return async (record: AgentSessionRecord): Promise<ResolvedHydrationRuntime> => {
    const runtimeKind = readPersistedRuntimeKind(record);
    const runtime = findRepoRuntime(runtimeKind);
    if (!runtime) {
      return {
        ok: false,
        runtimeKind,
        reason: `No live repo runtime found for repo ${repoPath} and runtime ${runtimeKind}.`,
      };
    }
    return {
      ok: true,
      runtimeKind,
      runtimeId: runtime.runtimeId,
      workingDirectory: record.workingDirectory,
    };
  };
};
