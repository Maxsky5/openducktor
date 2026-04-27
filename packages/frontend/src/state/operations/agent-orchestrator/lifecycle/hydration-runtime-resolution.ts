import type {
  AgentSessionRecord,
  RuntimeInstanceSummary,
  RuntimeKind,
  RuntimeRoute,
} from "@openducktor/contracts";
import type { AgentRuntimeConnection, LiveAgentSessionSnapshot } from "@openducktor/core";
import {
  resolveRuntimeRouteConnection,
  runtimeConnectionToRoute,
  runtimeConnectionTransportKey,
} from "../runtime/runtime";
import { normalizeWorkingDirectory } from "../support/core";
import { readPersistedRuntimeKind } from "../support/session-runtime-metadata";
import { canUseWorkspaceRuntimeForHydration } from "./hydration-runtime-policy";
import {
  liveAgentSessionLookupKey,
  type RuntimeConnectionPreloadIndex,
} from "./live-agent-session-cache";

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

type PreloadedRuntimeConnectionLookupResult =
  | { ok: true; runtimeConnection: AgentRuntimeConnection | null }
  | { ok: false; reason: string };

type RuntimeSnapshotCandidate = {
  runtime: RuntimeInstanceSummary;
  runtimeConnection: AgentRuntimeConnection;
};

type SnapshotConnectionMatchResult =
  | { ok: true; runtimeConnection: AgentRuntimeConnection | null }
  | { ok: false; reason: string };

const hasAmbiguousStdioRoutes = (runtimes: RuntimeInstanceSummary[]): boolean =>
  runtimes.length > 1 && runtimes.some((runtime) => runtime.runtimeRoute.type === "stdio");

export const createHydrationRuntimeResolver = ({
  repoPath,
  runtimesByKind,
  preloadedRuntimeConnections,
  preloadedLiveAgentSessionsByKey,
  ensureWorkspaceRuntime,
}: {
  repoPath: string;
  runtimesByKind: Map<RuntimeKind, RuntimeInstanceSummary[]>;
  preloadedRuntimeConnections?: RuntimeConnectionPreloadIndex;
  preloadedLiveAgentSessionsByKey?: Map<string, LiveAgentSessionSnapshot[]>;
  ensureWorkspaceRuntime: (runtimeKind: RuntimeKind) => Promise<RuntimeInstanceSummary | null>;
}): ((record: AgentSessionRecord) => Promise<ResolvedHydrationRuntime>) => {
  const normalizedRepoPath = normalizeWorkingDirectory(repoPath);

  const findPreloadedSnapshotConnection = (
    runtimeKind: RuntimeKind,
    workingDirectory: string,
    externalSessionId: string,
    runtimeConnections: AgentRuntimeConnection[],
  ): SnapshotConnectionMatchResult => {
    if (!preloadedLiveAgentSessionsByKey) {
      return { ok: true, runtimeConnection: null };
    }

    const matchesByTransportKey = new Map<string, AgentRuntimeConnection>();
    for (const runtimeConnection of runtimeConnections) {
      const snapshots = preloadedLiveAgentSessionsByKey.get(
        liveAgentSessionLookupKey(runtimeKind, runtimeConnection, workingDirectory),
      );
      if (!snapshots?.some((snapshot) => snapshot.externalSessionId === externalSessionId)) {
        continue;
      }
      matchesByTransportKey.set(
        runtimeConnectionTransportKey(runtimeConnection),
        runtimeConnection,
      );
    }

    if (matchesByTransportKey.size > 1) {
      return {
        ok: false,
        reason: `Multiple preloaded live sessions found for external session ${externalSessionId} in working directory ${workingDirectory}.`,
      };
    }

    return {
      ok: true,
      runtimeConnection: Array.from(matchesByTransportKey.values())[0] ?? null,
    };
  };

  const disambiguateAmbiguousStdioMatches = (
    runtimeKind: RuntimeKind,
    workingDirectory: string,
    externalSessionId: string,
    matches: RuntimeInstanceSummary[],
  ): RuntimeLookupResult | null => {
    if (!hasAmbiguousStdioRoutes(matches)) {
      return null;
    }

    const candidates: RuntimeSnapshotCandidate[] = matches.map((runtime) => ({
      runtime,
      runtimeConnection: resolveRuntimeRouteConnection(runtime.runtimeRoute, workingDirectory)
        .runtimeConnection,
    }));
    const snapshotMatch = findPreloadedSnapshotConnection(
      runtimeKind,
      workingDirectory,
      externalSessionId,
      candidates.map((candidate) => candidate.runtimeConnection),
    );
    if (!snapshotMatch.ok) {
      return { ok: false, reason: snapshotMatch.reason };
    }
    if (!snapshotMatch.runtimeConnection) {
      return { ok: true, runtime: null };
    }

    const matchedTransportKey = runtimeConnectionTransportKey(snapshotMatch.runtimeConnection);
    const matchedCandidates = candidates.filter(
      (candidate) =>
        runtimeConnectionTransportKey(candidate.runtimeConnection) === matchedTransportKey,
    );
    const [matchedCandidate] = matchedCandidates;
    if (matchedCandidates.length === 1 && matchedCandidate) {
      return { ok: true, runtime: matchedCandidate.runtime };
    }
    return {
      ok: false,
      reason: `Multiple live stdio runtimes share transport identity ${matchedTransportKey} for working directory ${workingDirectory}.`,
    };
  };

  const findRuntimeByWorkingDirectory = (
    runtimeKind: RuntimeKind,
    workingDirectory: string,
    externalSessionId: string,
    includeRepoRootWorkspaceRuntimes: boolean,
  ): RuntimeLookupResult => {
    const runtimes = runtimesByKind.get(runtimeKind) ?? [];
    const normalizedDirectory = normalizeWorkingDirectory(workingDirectory);
    const isRepoRootWorkspaceRuntime = (runtime: RuntimeInstanceSummary): boolean =>
      runtime.role === "workspace" &&
      normalizeWorkingDirectory(runtime.workingDirectory) === normalizedRepoPath;
    const matches = runtimes.filter(
      (runtime) =>
        normalizeWorkingDirectory(runtime.workingDirectory) === normalizedDirectory &&
        (includeRepoRootWorkspaceRuntimes || !isRepoRootWorkspaceRuntime(runtime)),
    );
    const ambiguousMatch = disambiguateAmbiguousStdioMatches(
      runtimeKind,
      workingDirectory,
      externalSessionId,
      matches,
    );
    if (ambiguousMatch) {
      if (!ambiguousMatch.ok || ambiguousMatch.runtime) {
        return ambiguousMatch;
      }
      return {
        ok: false,
        reason: `Multiple live stdio runtimes found for working directory ${workingDirectory}.`,
      };
    }

    return { ok: true, runtime: matches[0] ?? null };
  };

  const findWorkspaceRuntime = (
    runtimeKind: RuntimeKind,
    workingDirectory: string,
    externalSessionId: string,
  ): RuntimeLookupResult => {
    const runtimes = runtimesByKind.get(runtimeKind) ?? [];
    const matches = runtimes.filter(
      (runtime) =>
        runtime.role === "workspace" &&
        normalizeWorkingDirectory(runtime.workingDirectory) === normalizedRepoPath,
    );
    const ambiguousMatch = disambiguateAmbiguousStdioMatches(
      runtimeKind,
      workingDirectory,
      externalSessionId,
      matches,
    );
    if (ambiguousMatch) {
      if (!ambiguousMatch.ok || ambiguousMatch.runtime) {
        return ambiguousMatch;
      }
      return {
        ok: false,
        reason: `Multiple live stdio workspace runtimes found for repo ${repoPath}.`,
      };
    }

    return { ok: true, runtime: matches[0] ?? null };
  };

  const findPreloadedRuntimeConnection = (
    runtimeKind: RuntimeKind,
    workingDirectory: string,
    externalSessionId: string,
  ): PreloadedRuntimeConnectionLookupResult => {
    if (!preloadedRuntimeConnections) {
      return { ok: true, runtimeConnection: null };
    }

    const candidates = preloadedRuntimeConnections.findCandidates(runtimeKind, workingDirectory);
    const candidatesByTransportKey = new Map(
      candidates.map((runtimeConnection) => [
        runtimeConnectionTransportKey(runtimeConnection),
        runtimeConnection,
      ]),
    );
    if (candidatesByTransportKey.size > 1) {
      const snapshotMatch = findPreloadedSnapshotConnection(
        runtimeKind,
        workingDirectory,
        externalSessionId,
        Array.from(candidatesByTransportKey.values()),
      );
      if (!snapshotMatch.ok) {
        return { ok: false, reason: snapshotMatch.reason };
      }
      if (snapshotMatch.runtimeConnection) {
        return { ok: true, runtimeConnection: snapshotMatch.runtimeConnection };
      }
      return {
        ok: false,
        reason: `Multiple preloaded runtime connections found for working directory ${workingDirectory}.`,
      };
    }

    return {
      ok: true,
      runtimeConnection: Array.from(candidatesByTransportKey.values())[0] ?? null,
    };
  };

  return async (record: AgentSessionRecord): Promise<ResolvedHydrationRuntime> => {
    const runtimeKind = readPersistedRuntimeKind(record);
    const workingDirectory = record.workingDirectory;
    const externalSessionId = record.externalSessionId ?? record.sessionId;
    const canUseWorkspaceRuntime = canUseWorkspaceRuntimeForHydration(record, repoPath);

    const runtimeForDirectory = findRuntimeByWorkingDirectory(
      runtimeKind,
      workingDirectory,
      externalSessionId,
      canUseWorkspaceRuntime,
    );
    if (!runtimeForDirectory.ok) {
      return {
        ok: false,
        runtimeKind,
        reason: runtimeForDirectory.reason,
      };
    }

    let runtime = runtimeForDirectory.runtime;
    if (!runtime && canUseWorkspaceRuntime) {
      const workspaceRuntime = findWorkspaceRuntime(
        runtimeKind,
        workingDirectory,
        externalSessionId,
      );
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

    if (
      !canUseWorkspaceRuntime &&
      normalizeWorkingDirectory(workingDirectory) === normalizedRepoPath
    ) {
      return {
        ok: false,
        runtimeKind,
        reason: `No live runtime found for working directory ${workingDirectory}.`,
      };
    }

    const preloadedRuntimeConnection = findPreloadedRuntimeConnection(
      runtimeKind,
      workingDirectory,
      externalSessionId,
    );
    if (!preloadedRuntimeConnection.ok) {
      return {
        ok: false,
        runtimeKind,
        reason: preloadedRuntimeConnection.reason,
      };
    }
    if (preloadedRuntimeConnection.runtimeConnection) {
      return {
        ok: true,
        runtimeKind,
        runtimeId: null,
        runtimeRoute: runtimeConnectionToRoute(preloadedRuntimeConnection.runtimeConnection),
        runtimeConnection: preloadedRuntimeConnection.runtimeConnection,
      };
    }

    if (!canUseWorkspaceRuntime) {
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
