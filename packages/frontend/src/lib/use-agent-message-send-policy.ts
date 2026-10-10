import { useCallback, useLayoutEffect, useRef } from "react";
import {
  useHostRuntimeStatusContext,
  useRuntimeAvailabilityContext,
} from "@/state/app-state-contexts";
import { useAgentSessionReadModelState } from "@/state/app-state-provider";
import type { AgentMessageSendOptions } from "@/types/agent-orchestrator";
import { getAgentMessageSendBlockedReason } from "./agent-message-send-policy";
import { deriveRuntimeReadiness, runtimeReadinessTargetForRuntime } from "./runtime-readiness";

export function useAgentMessageSendPolicy(): NonNullable<
  AgentMessageSendOptions["assertCanSubmit"]
> {
  const runtime = useRuntimeAvailabilityContext();
  const runtimeStatus = useHostRuntimeStatusContext();
  const readModel = useAgentSessionReadModelState();
  const current = useRef({ runtime, runtimeStatus, readModel });
  useLayoutEffect(() => {
    current.current = { runtime, runtimeStatus, readModel };
  }, [runtime, runtimeStatus, readModel]);
  return useCallback<NonNullable<AgentMessageSendOptions["assertCanSubmit"]>>((session): void => {
    const { runtime, runtimeStatus, readModel } = current.current;
    const fault = readModel.getSessionFault(session);
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
      readOnlyReason: fault?.source === "workspace-target" ? fault.message : null,
      pending: false,
    });
    if (reason) throw new Error(reason);
  }, []);
}
