import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveRef,
  StartupOperationContext,
  StartupOperationSnapshot,
  StartupOwnership,
  StartupScope,
} from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { registerStartupLiveSource } from "../sessions/startup/startup-prepared-handoff";

/** Publishes the live target separately from the host command receipt. */
export function createStartupLiveSourceFake(
  queryClient: QueryClient,
  { holdPreparedPublication = false }: { holdPreparedPublication?: boolean } = {},
) {
  const listeners = new Map<string, (event: AgentSessionLiveEnvelope) => void>();
  const preparedEvents: Array<{ repoPath: string; event: AgentSessionLiveEnvelope }> = [];
  let sequence = 0;
  const publish = (repoPath: string, event: AgentSessionLiveEnvelope) =>
    listeners.get(repoPath)?.(event);
  const release = registerStartupLiveSource(queryClient, {
    observeWorkspace: () => () => {},
    observeAgentSessionLive: async ({ repoPath }, listener) => {
      listeners.set(repoPath, listener);
      listener({ type: "snapshot", repoPath, sequence, sessions: [], messageQueues: [] });
      return () => {
        listeners.delete(repoPath);
      };
    },
  });
  return {
    publish,
    publishPrepared(): void {
      for (const { repoPath, event } of preparedEvents.splice(0)) publish(repoPath, event);
    },
    dispose: release,
    remove(ref: AgentSessionLiveRef): void {
      sequence += 1;
      publish(ref.repoPath, { type: "session_removed", sequence, ref });
    },
    prepared(input: {
      context: StartupOperationContext;
      workspaceId: string;
      repoPath: string;
      scope: StartupScope;
      ownership: Extract<StartupOwnership, { state: "saved" }>;
    }): StartupOperationSnapshot {
      const { target } = input.ownership;
      const runtime = target.runtimeSession;
      if (!runtime) throw new Error("A prepared fixture needs its native session.");
      const ref = {
        repoPath: input.repoPath,
        runtimeKind: runtime.runtimeKind,
        externalSessionId: runtime.externalSessionId,
        workingDirectory: runtime.workingDirectory,
      };
      sequence += 1;
      const event: AgentSessionLiveEnvelope = {
        type: "session_upsert",
        sequence,
        session: {
          ref,
          activity: "idle",
          startedAt: runtime.startedAt,
          title: "Started session",
          pendingApprovals: [],
          pendingQuestions: [],
          contextUsage: null,
        },
      };
      if (holdPreparedPublication) preparedEvents.push({ repoPath: input.repoPath, event });
      else publish(input.repoPath, event);
      return {
        ...input,
        hostInstanceId: "host",
        revision: 1,
        phase: "completed",
        steps: [],
        prepared: { ref, runtimeId: "runtime", liveStateSequence: sequence },
      };
    },
  };
}
