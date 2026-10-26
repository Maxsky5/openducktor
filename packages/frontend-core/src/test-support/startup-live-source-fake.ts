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
export function createStartupLiveSourceFake(queryClient: QueryClient) {
  const listeners = new Map<string, (event: AgentSessionLiveEnvelope) => void>();
  let sequence = 0;
  registerStartupLiveSource(queryClient, {
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
    remove(ref: AgentSessionLiveRef): void {
      sequence += 1;
      listeners.get(ref.repoPath)?.({ type: "session_removed", sequence, ref });
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
      listeners.get(input.repoPath)?.({
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
      });
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
