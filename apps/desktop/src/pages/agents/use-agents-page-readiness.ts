import { useEffect, useMemo, useRef, useState } from "react";
import type { useChecksState } from "@/state";
import type { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import type {
  AgentStudioOrchestrationReadinessContext,
  AgentStudioOrchestrationSelectionContext,
} from "./use-agent-studio-orchestration-controller";

type UseRunCompletionRecoverySignalArgs = {
  activeSession: AgentStudioOrchestrationSelectionContext["viewActiveSession"];
  runCompletionSignal: {
    runId: string;
    version: number;
  } | null;
};

export function useRunCompletionRecoverySignal({
  activeSession,
  runCompletionSignal,
}: UseRunCompletionRecoverySignalArgs): number {
  const [runCompletionRecoverySignal, setRunCompletionRecoverySignal] = useState(0);
  const latestRunCompletionSignalVersionRef = useRef<number | null>(null);

  useEffect(() => {
    const activeBuildRunId = activeSession?.role === "build" ? activeSession.runId : null;

    if (!runCompletionSignal || !activeBuildRunId) {
      return;
    }

    if (runCompletionSignal.runId !== activeBuildRunId) {
      return;
    }

    if (runCompletionSignal.version === latestRunCompletionSignalVersionRef.current) {
      return;
    }

    latestRunCompletionSignalVersionRef.current = runCompletionSignal.version;
    setRunCompletionRecoverySignal((current) => current + 1);
  }, [activeSession, runCompletionSignal]);

  return runCompletionRecoverySignal;
}

type UseAgentStudioReadinessArgs = {
  activeRepo: string | null;
  runtimeDefinitions: ReturnType<typeof useRuntimeDefinitionsContext>["runtimeDefinitions"];
  isLoadingRuntimeDefinitions: ReturnType<
    typeof useRuntimeDefinitionsContext
  >["isLoadingRuntimeDefinitions"];
  runtimeDefinitionsError: ReturnType<
    typeof useRuntimeDefinitionsContext
  >["runtimeDefinitionsError"];
  runtimeHealthByRuntime: ReturnType<typeof useChecksState>["runtimeHealthByRuntime"];
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
};

export function useAgentStudioReadiness({
  activeRepo,
  runtimeDefinitions,
  isLoadingRuntimeDefinitions,
  runtimeDefinitionsError,
  runtimeHealthByRuntime,
  isLoadingChecks,
  refreshChecks,
}: UseAgentStudioReadinessArgs): AgentStudioOrchestrationReadinessContext {
  const healthyRuntimeDefinition = useMemo(
    () =>
      runtimeDefinitions.find((definition) => {
        const runtimeHealth = runtimeHealthByRuntime[definition.kind];
        return Boolean(
          runtimeHealth?.runtimeOk &&
            (!definition.capabilities.supportsMcpStatus || runtimeHealth.mcpOk),
        );
      }) ?? null,
    [runtimeDefinitions, runtimeHealthByRuntime],
  );
  const blockedRuntimeDefinition = useMemo(
    () =>
      runtimeDefinitions.find((definition) => {
        const runtimeHealth = runtimeHealthByRuntime[definition.kind];
        return Boolean(
          runtimeHealth &&
            (!runtimeHealth.runtimeOk ||
              (definition.capabilities.supportsMcpStatus && !runtimeHealth.mcpOk)),
        );
      }) ?? null,
    [runtimeDefinitions, runtimeHealthByRuntime],
  );
  const blockedRuntimeHealth = blockedRuntimeDefinition
    ? (runtimeHealthByRuntime[blockedRuntimeDefinition.kind] ?? null)
    : null;

  const agentStudioReady = Boolean(activeRepo && healthyRuntimeDefinition);
  const agentStudioBlockedReason = (() => {
    if (agentStudioReady) {
      return null;
    }
    if (!activeRepo) {
      return "Select a repository to use Agent Studio.";
    }
    if (runtimeDefinitionsError) {
      return runtimeDefinitionsError;
    }
    if (isLoadingRuntimeDefinitions) {
      return "Loading runtime definitions...";
    }
    if (isLoadingChecks) {
      return "Checking runtime and OpenDucktor MCP health...";
    }

    return (
      blockedRuntimeHealth?.runtimeError ??
      blockedRuntimeHealth?.mcpError ??
      (runtimeDefinitions.length === 0
        ? "No agent runtimes are available."
        : "No configured runtime is ready for Agent Studio.")
    );
  })();

  return {
    agentStudioReady,
    agentStudioBlockedReason,
    isLoadingChecks,
    refreshChecks,
  };
}
