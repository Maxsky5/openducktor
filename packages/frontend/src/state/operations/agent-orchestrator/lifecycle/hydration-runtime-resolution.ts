import type {
  AgentSessionRecord,
  RuntimeInstanceSummary,
  RuntimeKind,
  RuntimeRoute,
} from "@openducktor/contracts";
import type { AgentRuntimeConnection } from "@openducktor/core";
import { resolveRuntimeRouteConnection, runtimeConnectionToRoute } from "../runtime/runtime";
import { normalizeWorkingDirectory } from "../support/core";
import { readPersistedRuntimeKind } from "../support/session-runtime-metadata";
import { canUseWorkspaceRuntimeForHydration } from "./hydration-runtime-policy";
import { runtimeWorkingDirectoryKey } from "./live-agent-session-cache";

export type ResolvedHydrationRuntime =
  | {
      ok: true;
      runtimeKind: RuntimeKind;
      runtimeId: string | null;
      runtimeRoute: RuntimeRoute;
      runtimeConnection: AgentRuntimeConnection;
    }
  | {
      ok: false;
      runtimeKind: RuntimeKind;
      reason: string;
    };

export const createHydrationRuntimeResolver = ({
  repoPath,
  runtimesByKind,
  preloadedRuntimeConnectionsByKey,
  ensureWorkspaceRuntime,
}: {
  repoPath: string;
  runtimesByKind: Map<RuntimeKind, RuntimeInstanceSummary[]>;
  preloadedRuntimeConnectionsByKey?: Map<string, AgentRuntimeConnection>;
  ensureWorkspaceRuntime: (runtimeKind: RuntimeKind) => Promise<RuntimeInstanceSummary | null>;
}): ((record: AgentSessionRecord) => Promise<ResolvedHydrationRuntime>) => {
  const normalizedRepoPath = normalizeWorkingDirectory(repoPath);

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

  const findWorkspaceRuntime = (runtimeKind: RuntimeKind): RuntimeInstanceSummary | null => {
    const runtimes = runtimesByKind.get(runtimeKind) ?? [];
    return (
      runtimes.find(
        (runtime) =>
          runtime.role === "workspace" &&
          normalizeWorkingDirectory(runtime.workingDirectory) === normalizedRepoPath,
      ) ?? null
    );
  };

  return async (record: AgentSessionRecord): Promise<ResolvedHydrationRuntime> => {
    const runtimeKind = readPersistedRuntimeKind(record);
    const workingDirectory = record.workingDirectory;

    const runtime =
      findRuntimeByWorkingDirectory(runtimeKind, workingDirectory) ??
      (canUseWorkspaceRuntimeForHydration(record, repoPath)
        ? findWorkspaceRuntime(runtimeKind)
        : null);
    if (runtime) {
      const { runtimeConnection } = resolveRuntimeRouteConnection(
        runtime.runtimeRoute,
        workingDirectory,
      );
      return {
        ok: true,
        runtimeKind,
        runtimeId: runtime.runtimeId,
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
        runtimeRoute: runtimeConnectionToRoute(preloadedRuntimeConnection),
        runtimeConnection: preloadedRuntimeConnection,
      };
    }

    if (!canUseWorkspaceRuntimeForHydration(record, repoPath)) {
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
        reason: `No live runtime found for working directory ${workingDirectory}.`,
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
      runtimeRoute: workspaceRuntime.runtimeRoute,
      runtimeConnection,
    };
  };
};
