import {
  createHydrationRuntimeResolver,
  type ResolvedHydrationRuntime,
} from "./hydration-runtime-resolution";
import type {
  HydrationRuntimePlanner,
  RuntimeResolutionPlannerStageInput,
} from "./load-sessions-stages";
import { type AgentSessionPresenceSnapshot, createSessionPresenceReader } from "./session-presence";
import { createAgentSessionPresenceSnapshotSource } from "./session-presence-source";

export const createRuntimeResolutionPlannerStage = async ({
  intent,
  options,
  adapter,
}: RuntimeResolutionPlannerStageInput): Promise<HydrationRuntimePlanner> => {
  const preloadedSessionPresenceByKey =
    options?.preloadedSessionPresenceByKey ?? new Map<string, AgentSessionPresenceSnapshot[]>();

  const resolveHydrationRuntime = createHydrationRuntimeResolver({
    repoPath: intent.repoPath,
  });
  const sessionPresenceSource = createAgentSessionPresenceSnapshotSource({
    adapter,
    preloadedSessionPresenceByKey,
  });
  const readSessionPresence = createSessionPresenceReader({
    repoPath: intent.repoPath,
    resolveHydrationRuntime,
    readPresence: sessionPresenceSource.read,
  });

  return {
    repoPath: intent.repoPath,
    resolveHydrationRuntime,
    readSessionPresence,
  };
};

export type { ResolvedHydrationRuntime };
export type SuccessfulHydrationRuntime = Extract<ResolvedHydrationRuntime, { ok: true }>;
export type FailedHydrationRuntime = Extract<ResolvedHydrationRuntime, { ok: false }>;
