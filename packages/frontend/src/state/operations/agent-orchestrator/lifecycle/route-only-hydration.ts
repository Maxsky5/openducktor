import type { RuntimeInstanceSummary, RuntimeKind } from "@openducktor/contracts";
import type { AgentRuntimeConnection, LiveAgentSessionSnapshot } from "@openducktor/core";
import { runtimeRouteToConnection } from "../runtime/runtime";
import { normalizeWorkingDirectory } from "../support/core";
import {
  liveAgentSessionLookupKey,
  type RuntimeConnectionPreloadIndex,
} from "./live-agent-session-cache";

type LiveAgentSessionScanner = {
  listLiveAgentSessionSnapshots: (input: {
    runtimeKind: RuntimeKind;
    runtimeConnection: AgentRuntimeConnection;
    directories?: string[];
  }) => Promise<LiveAgentSessionSnapshot[]>;
};

export type RouteOnlyHydrationPreloadResult = {
  runtimeConnection: AgentRuntimeConnection;
  liveSessionsForDirectory: LiveAgentSessionSnapshot[];
};

export const isRepoRootWorkspaceRuntime = (
  runtime: RuntimeInstanceSummary,
  repoPath: string,
): boolean => {
  const normalizedRepoPath = normalizeWorkingDirectory(repoPath);
  return (
    runtime.role === "workspace" &&
    normalizeWorkingDirectory(runtime.workingDirectory) === normalizedRepoPath
  );
};

export const hasExactNonRepoRootRuntime = ({
  runtimes,
  workingDirectory,
  repoPath,
}: {
  runtimes: RuntimeInstanceSummary[];
  workingDirectory: string;
  repoPath: string;
}): boolean => {
  const normalizedRepoPath = normalizeWorkingDirectory(repoPath);
  const normalizedWorkingDirectory = normalizeWorkingDirectory(workingDirectory);
  return runtimes.some(
    (runtime) =>
      normalizeWorkingDirectory(runtime.workingDirectory) === normalizedWorkingDirectory &&
      !isRepoRootWorkspaceRuntime(runtime, normalizedRepoPath),
  );
};

export const canUseRuntimeForRouteOnlyHydration = (
  runtime: RuntimeInstanceSummary,
  repoPath: string,
): boolean =>
  isRepoRootWorkspaceRuntime(runtime, repoPath) && runtime.runtimeRoute.type !== "stdio";

export const createRouteOnlyHydrationRuntimeConnection = (
  runtime: RuntimeInstanceSummary,
  workingDirectory: string,
): AgentRuntimeConnection =>
  runtimeRouteToConnection(runtime.runtimeRoute, normalizeWorkingDirectory(workingDirectory));

export const createRouteOnlyHydrationLookupKey = ({
  runtimeKind,
  runtimeConnection,
  workingDirectory,
}: {
  runtimeKind: RuntimeKind;
  runtimeConnection: AgentRuntimeConnection;
  workingDirectory: string;
}): string => liveAgentSessionLookupKey(runtimeKind, runtimeConnection, workingDirectory);

export const scanRouteOnlyHydrationDirectory = async ({
  scanner,
  runtimeKind,
  runtime,
  repoPath,
  workingDirectory,
}: {
  scanner: LiveAgentSessionScanner;
  runtimeKind: RuntimeKind;
  runtime: RuntimeInstanceSummary;
  repoPath: string;
  workingDirectory: string;
}): Promise<RouteOnlyHydrationPreloadResult | null> => {
  const normalizedWorkingDirectory = normalizeWorkingDirectory(workingDirectory);
  if (!canUseRuntimeForRouteOnlyHydration(runtime, repoPath)) {
    return null;
  }

  const runtimeConnection = createRouteOnlyHydrationRuntimeConnection(
    runtime,
    normalizedWorkingDirectory,
  );
  const liveSessions = await scanner.listLiveAgentSessionSnapshots({
    runtimeKind,
    runtimeConnection,
    directories: [normalizedWorkingDirectory],
  });
  const liveSessionsForDirectory = liveSessions.filter(
    (session) => normalizeWorkingDirectory(session.workingDirectory) === normalizedWorkingDirectory,
  );
  return {
    runtimeConnection,
    liveSessionsForDirectory,
  };
};

export const recordRouteOnlyHydrationPreload = ({
  runtimeKind,
  runtimeConnection,
  workingDirectory,
  preloadedRuntimeConnections,
  routeProbedHydrationRuntimeConnections,
  preloadedLiveAgentSessionsByKey,
  liveSessionsForDirectory,
}: {
  runtimeKind: RuntimeKind;
  runtimeConnection: AgentRuntimeConnection;
  workingDirectory: string;
  preloadedRuntimeConnections: RuntimeConnectionPreloadIndex;
  routeProbedHydrationRuntimeConnections?: RuntimeConnectionPreloadIndex;
  preloadedLiveAgentSessionsByKey: Map<string, LiveAgentSessionSnapshot[]>;
  liveSessionsForDirectory: LiveAgentSessionSnapshot[];
}): void => {
  preloadedRuntimeConnections.add(runtimeKind, runtimeConnection);
  routeProbedHydrationRuntimeConnections?.add(runtimeKind, runtimeConnection);
  const lookupKey = createRouteOnlyHydrationLookupKey({
    runtimeKind,
    runtimeConnection,
    workingDirectory,
  });
  preloadedLiveAgentSessionsByKey.set(lookupKey, liveSessionsForDirectory);
};
