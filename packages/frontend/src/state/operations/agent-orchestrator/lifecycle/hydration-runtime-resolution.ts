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

type RuntimeLookupResult =
  | { ok: true; runtime: RuntimeInstanceSummary | null }
  | { ok: false; reason: string };

const hasAmbiguousStdioRoutes = (runtimes: RuntimeInstanceSummary[]): boolean => {
  const identities = new Set(
    runtimes
      .map((runtime) => runtime.runtimeRoute)
      .filter((route): route is Extract<RuntimeRoute, { type: "stdio" }> => route.type === "stdio")
      .map((route) => route.identity.trim()),
  );

  return identities.size > 1;
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
  ): RuntimeLookupResult => {
    const runtimes = runtimesByKind.get(runtimeKind) ?? [];
    const normalizedDirectory = normalizeWorkingDirectory(workingDirectory);
    const matches = runtimes.filter(
      (runtime) => normalizeWorkingDirectory(runtime.workingDirectory) === normalizedDirectory,
    );
    if (hasAmbiguousStdioRoutes(matches)) {
      return {
        ok: false,
        reason: `Multiple live stdio runtimes found for working directory ${workingDirectory}.`,
      };
    }

    return { ok: true, runtime: matches[0] ?? null };
  };

  const findWorkspaceRuntime = (runtimeKind: RuntimeKind): RuntimeLookupResult => {
    const runtimes = runtimesByKind.get(runtimeKind) ?? [];
    const matches = runtimes.filter(
      (runtime) =>
        runtime.role === "workspace" &&
        normalizeWorkingDirectory(runtime.workingDirectory) === normalizedRepoPath,
    );
    if (hasAmbiguousStdioRoutes(matches)) {
      return {
        ok: false,
        reason: `Multiple live stdio workspace runtimes found for repo ${repoPath}.`,
      };
    }

    return { ok: true, runtime: matches[0] ?? null };
  };

  return async (record: AgentSessionRecord): Promise<ResolvedHydrationRuntime> => {
    const runtimeKind = readPersistedRuntimeKind(record);
    const workingDirectory = record.workingDirectory;

    const runtimeForDirectory = findRuntimeByWorkingDirectory(runtimeKind, workingDirectory);
    if (!runtimeForDirectory.ok) {
      return {
        ok: false,
        runtimeKind,
        reason: runtimeForDirectory.reason,
      };
    }

    let runtime = runtimeForDirectory.runtime;
    if (!runtime && canUseWorkspaceRuntimeForHydration(record, repoPath)) {
      const workspaceRuntime = findWorkspaceRuntime(runtimeKind);
      if (!workspaceRuntime.ok) {
        return {
          ok: false,
          runtimeKind,
          reason: workspaceRuntime.reason,
        };
      }
      runtime = workspaceRuntime.runtime;
    }
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
