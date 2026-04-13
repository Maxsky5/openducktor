import type {
  AgentSessionRecord,
  RunSummary,
  RuntimeRoute,
  RuntimeInstanceSummary,
  RuntimeKind,
} from "@openducktor/contracts";
import type { AgentRuntimeConnection } from "@openducktor/core";
import { resolveRuntimeRouteConnection, runtimeConnectionToRoute } from "../runtime/runtime";
import { normalizeWorkingDirectory } from "../support/core";
import { runtimeWorkingDirectoryKey } from "./live-agent-session-cache";

export type ResolvedHydrationRuntime =
  | {
      ok: true;
      runtimeKind: RuntimeKind;
      runtimeId: string | null;
      runId: string | null;
      runtimeRoute: RuntimeRoute;
      runtimeConnection: AgentRuntimeConnection;
    }
  | {
      ok: false;
      runtimeKind: RuntimeKind;
      reason: string;
    };

export const readPersistedRuntimeKind = ({
  sessionId,
  runtimeKind,
  selectedModel,
}: Pick<AgentSessionRecord, "sessionId" | "runtimeKind" | "selectedModel">): RuntimeKind => {
  const resolvedRuntimeKind = runtimeKind ?? selectedModel?.runtimeKind;
  if (!resolvedRuntimeKind) {
    throw new Error(`Persisted session '${sessionId}' is missing runtime kind metadata.`);
  }
  return resolvedRuntimeKind;
};

export const createHydrationRuntimeResolver = ({
  repoPath,
  liveRuns,
  runtimesByKind,
  preloadedRuntimeConnectionsByKey,
  ensureWorkspaceRuntime,
}: {
  repoPath: string;
  liveRuns: RunSummary[];
  runtimesByKind: Map<RuntimeKind, RuntimeInstanceSummary[]>;
  preloadedRuntimeConnectionsByKey?: Map<string, AgentRuntimeConnection>;
  ensureWorkspaceRuntime: (runtimeKind: RuntimeKind) => Promise<RuntimeInstanceSummary | null>;
}): ((record: AgentSessionRecord) => Promise<ResolvedHydrationRuntime>) => {
  const isRepoRootSession = (workingDirectory: string): boolean => {
    return normalizeWorkingDirectory(workingDirectory) === normalizeWorkingDirectory(repoPath);
  };

  const canEnsureWorkspaceRuntime = (record: AgentSessionRecord): boolean => {
    if (record.role === "spec" || record.role === "planner") {
      return isRepoRootSession(record.workingDirectory);
    }
    return false;
  };

  const findRuntimeByWorkingDirectory = (
    runtimeKind: RuntimeKind,
    workingDirectory: string,
  ): RuntimeInstanceSummary | null => {
    const runtimes = runtimesByKind.get(runtimeKind) ?? [];
    const normalizedDirectory = normalizeWorkingDirectory(workingDirectory);
    return (
      runtimes.find(
        (runtime) => normalizeWorkingDirectory(runtime.workingDirectory) === normalizedDirectory,
      ) ?? null
    );
  };

  const findRunByWorkingDirectory = (
    runtimeKind: RuntimeKind,
    workingDirectory: string,
  ): RunSummary | null => {
    const normalizedDirectory = normalizeWorkingDirectory(workingDirectory);
    return (
      liveRuns.find(
        (run) =>
          run.runtimeKind === runtimeKind &&
          normalizeWorkingDirectory(run.worktreePath) === normalizedDirectory,
      ) ?? null
    );
  };

  return async (record: AgentSessionRecord): Promise<ResolvedHydrationRuntime> => {
    const runtimeKind = readPersistedRuntimeKind(record);
    const workingDirectory = record.workingDirectory;

    if (record.role === "build" || record.role === "qa") {
      const run = findRunByWorkingDirectory(runtimeKind, workingDirectory);
      if (run) {
        const { runtimeConnection } = resolveRuntimeRouteConnection(
          run.runtimeRoute,
          workingDirectory,
        );
        return {
          ok: true,
          runtimeKind,
          runtimeId: null,
          runId: run.runId,
          runtimeRoute: run.runtimeRoute,
          runtimeConnection,
        };
      }
    }

    const runtime = findRuntimeByWorkingDirectory(runtimeKind, workingDirectory);
    if (runtime) {
      const { runtimeConnection } = resolveRuntimeRouteConnection(
        runtime.runtimeRoute,
        workingDirectory,
      );
      return {
        ok: true,
        runtimeKind,
        runtimeId: runtime.runtimeId,
        runId: null,
        runtimeRoute: runtime.runtimeRoute,
        runtimeConnection,
      };
    }

    const preloadedRuntimeConnection = preloadedRuntimeConnectionsByKey?.get(
      runtimeWorkingDirectoryKey(runtimeKind, workingDirectory),
    );
    if (preloadedRuntimeConnection) {
      return {
        ok: true,
        runtimeKind,
        runtimeId: null,
        runId: null,
        runtimeRoute: runtimeConnectionToRoute(preloadedRuntimeConnection),
        runtimeConnection: preloadedRuntimeConnection,
      };
    }

    if (!canEnsureWorkspaceRuntime(record)) {
      return {
        ok: false,
        runtimeKind,
        reason: `No live runtime found for working directory ${workingDirectory}.`,
      };
    }

    const workspaceRuntime = await ensureWorkspaceRuntime(runtimeKind);
    if (!workspaceRuntime) {
      return {
        ok: false,
        runtimeKind,
        reason: `Runtime ${runtimeKind} is unavailable for session hydration.`,
      };
    }
    const { runtimeConnection } = resolveRuntimeRouteConnection(
      workspaceRuntime.runtimeRoute,
      workingDirectory,
    );
    return {
      ok: true,
      runtimeKind,
      runtimeId: workspaceRuntime.runtimeId,
      runId: null,
      runtimeRoute: workspaceRuntime.runtimeRoute,
      runtimeConnection,
    };
  };
};
