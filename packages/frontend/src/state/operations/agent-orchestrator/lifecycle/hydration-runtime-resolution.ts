import type {
  AgentSessionRecord,
  RepoRuntimeRef,
  RuntimeKind,
} from "@openducktor/contracts";
import { normalizeWorkingDirectory } from "../support/core";
import { readPersistedRuntimeKind } from "../support/session-runtime-metadata";

export type ResolvedHydrationRuntime =
  | {
      ok: true;
      runtimeRef: RepoRuntimeRef;
      workingDirectory: string;
    }
  | {
      ok: false;
      runtimeKind: RuntimeKind;
      reason: string;
    };

export const createHydrationRuntimeResolver = ({
  repoPath,
}: {
  repoPath: string;
}): ((record: AgentSessionRecord) => Promise<ResolvedHydrationRuntime>) => {
  const normalizedRepoPath = normalizeWorkingDirectory(repoPath);
  return async (record: AgentSessionRecord): Promise<ResolvedHydrationRuntime> => {
    const runtimeKind = readPersistedRuntimeKind(record);
    const workingDirectory = normalizeWorkingDirectory(record.workingDirectory);
    if (!workingDirectory) {
      return {
        ok: false,
        runtimeKind,
        reason: `Cannot hydrate session ${record.externalSessionId} without a working directory.`,
      };
    }

    return {
      ok: true,
      runtimeRef: {
        repoPath: normalizedRepoPath,
        runtimeKind,
      },
      workingDirectory,
    };
  };
};
