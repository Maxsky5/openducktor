import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";
import { type AgentDeliveryAvailability, resolveRuntimeGoalAvailability } from "@openducktor/core";
import { useMemo } from "react";
import { useRuntimeAvailabilityContext } from "../../app-state/app-state-contexts";
import { useHostRuntimeStatusContext } from "../session-contexts";
import { MISSING_RUNTIME_REASON } from "../send/agent-message-send-policy";

const MISSING_RUNTIME: AgentDeliveryAvailability = {
  available: false,
  reason: MISSING_RUNTIME_REASON,
};

/** Tells if the runtime of a kind has native goals, with its read version. */
export const useRuntimeGoalAvailability = (
  runtimeKind: RuntimeKind | null,
): AgentDeliveryAvailability | null => {
  const { allRuntimeDefinitions } = useRuntimeAvailabilityContext();
  const { statusByKind } = useHostRuntimeStatusContext();
  const version = runtimeKind ? (statusByKind[runtimeKind]?.version ?? null) : null;
  return useMemo(() => {
    if (!runtimeKind) return null;
    const descriptor = allRuntimeDefinitions.find(({ kind }) => kind === runtimeKind);
    return descriptor ? resolveRuntimeGoalAvailability(descriptor, version) : MISSING_RUNTIME;
  }, [allRuntimeDefinitions, runtimeKind, version]);
};

/** Tells if the runtime of a selected session has goals. Without a session, it has none. */
export const useSessionGoalsAvailable = (
  session: Pick<AgentSessionIdentity, "runtimeKind"> | null,
): boolean => useRuntimeGoalAvailability(session?.runtimeKind ?? null)?.available === true;
