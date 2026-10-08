import { useCallback, useLayoutEffect, useRef } from "react";
import {
  useHostRuntimeStatusContext,
  useRuntimeAvailabilityContext,
} from "@/state/app-state-contexts";
import { useAgentSessionReadModelState } from "@/state/app-state-provider";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { getAgentMessageSendBlockedReason } from "./agent-message-send-policy";
import { deriveRuntimeReadiness, runtimeReadinessTargetForRuntime } from "./runtime-readiness";

export function useAgentMessageSendPolicy(): (session: AgentSessionState) => void {
  const runtime = useRuntimeAvailabilityContext();
  const runtimeStatus = useHostRuntimeStatusContext();
  const readModel = useAgentSessionReadModelState();
  const current = useRef({ runtime, runtimeStatus, readModel });
  useLayoutEffect(() => {
    current.current = { runtime, runtimeStatus, readModel };
  }, [runtime, runtimeStatus, readModel]);
  return useCallback((session: AgentSessionState): void => {
    const { runtime, runtimeStatus, readModel } = current.current;
    const reason = getAgentMessageSendBlockedReason({
      session,
      runtime:
        runtime.allRuntimeDefinitions.find((entry) => entry.kind === session.runtimeKind) ?? null,
      readiness: deriveRuntimeReadiness({
        hasWorkspace: true,
        runtimeDefinitions: runtime.allRuntimeDefinitions,
        isLoadingRuntimeDefinitions: runtime.isLoadingRuntimeDefinitions,
        runtimeDefinitionsError: runtime.runtimeDefinitionsError,
        runtimeStatus,
        runtimeTarget: runtimeReadinessTargetForRuntime(session.runtimeKind),
      }),
      readModel: readModel.sessionReadModelLoadState,
      readOnlyReason: readModel.getSessionFault(session)?.message ?? null,
      pending: false,
      allowStarting: true,
    });
    if (reason) throw new Error(reason);
  }, []);
}
