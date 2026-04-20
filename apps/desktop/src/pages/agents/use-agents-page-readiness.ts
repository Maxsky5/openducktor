import { useMemo } from "react";
import { describeRepoRuntimeStatus, isRepoRuntimeReady } from "@/lib/repo-runtime-health";
import type { useChecksState } from "@/state";
import type { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { AgentStudioOrchestrationReadinessContext } from "./use-agent-studio-orchestration-controller";

const getBlockedRuntimeReason = (
  runtimeLabel: string,
  runtimeHealth: RepoRuntimeHealthCheck | null,
): string | null => {
  if (!runtimeHealth) {
    return null;
  }
  return describeRepoRuntimeStatus(runtimeLabel, runtimeHealth);
};

type UseAgentStudioReadinessArgs = {
  activeWorkspace: ActiveWorkspace | null;
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
  activeWorkspace,
  runtimeDefinitions,
  isLoadingRuntimeDefinitions,
  runtimeDefinitionsError,
  runtimeHealthByRuntime,
  isLoadingChecks,
  refreshChecks,
}: UseAgentStudioReadinessArgs): AgentStudioOrchestrationReadinessContext {
  const hasActiveWorkspace = activeWorkspace !== null;
  const isRuntimeHealthPending =
    hasActiveWorkspace &&
    runtimeDefinitions.length > 0 &&
    runtimeDefinitions.some((definition) => runtimeHealthByRuntime[definition.kind] === undefined);
  const healthyRuntimeDefinition = useMemo(
    () =>
      runtimeDefinitions.find((definition) => {
        const runtimeHealth = runtimeHealthByRuntime[definition.kind];
        return isRepoRuntimeReady(runtimeHealth ?? null);
      }) ?? null,
    [runtimeDefinitions, runtimeHealthByRuntime],
  );
  const checkingRuntimeDefinition = useMemo(
    () =>
      runtimeDefinitions.find(
        (definition) => runtimeHealthByRuntime[definition.kind]?.status === "checking",
      ) ?? null,
    [runtimeDefinitions, runtimeHealthByRuntime],
  );
  const blockedRuntimeDefinition = useMemo(
    () =>
      runtimeDefinitions.find((definition) => {
        const runtimeHealth = runtimeHealthByRuntime[definition.kind];
        return Boolean(
          runtimeHealth && runtimeHealth.status !== "ready" && runtimeHealth.status !== "checking",
        );
      }) ?? null,
    [runtimeDefinitions, runtimeHealthByRuntime],
  );
  const blockedRuntimeHealth = blockedRuntimeDefinition
    ? (runtimeHealthByRuntime[blockedRuntimeDefinition.kind] ?? null)
    : null;

  const agentStudioReady = Boolean(hasActiveWorkspace && healthyRuntimeDefinition);
  const agentStudioReadinessState = (() => {
    if (agentStudioReady) {
      return "ready";
    }
    if (hasActiveWorkspace && checkingRuntimeDefinition) {
      return "checking";
    }
    if (
      hasActiveWorkspace &&
      (isLoadingRuntimeDefinitions || isLoadingChecks || isRuntimeHealthPending)
    ) {
      return "checking";
    }

    return "blocked";
  })();
  const agentStudioBlockedReason = (() => {
    if (agentStudioReady) {
      return null;
    }
    if (!activeWorkspace) {
      return "Select a repository to use Agent Studio.";
    }
    if (runtimeDefinitionsError) {
      return runtimeDefinitionsError;
    }
    if (isLoadingRuntimeDefinitions) {
      return "Loading runtime definitions...";
    }
    if (isLoadingChecks) {
      if (checkingRuntimeDefinition) {
        return (
          getBlockedRuntimeReason(
            checkingRuntimeDefinition.label,
            runtimeHealthByRuntime[checkingRuntimeDefinition.kind] ?? null,
          ) ?? "Checking runtime health..."
        );
      }
      return blockedRuntimeDefinition
        ? (getBlockedRuntimeReason(blockedRuntimeDefinition.label, blockedRuntimeHealth) ??
            "Checking runtime health...")
        : "Checking runtime health...";
    }
    if (isRuntimeHealthPending) {
      if (checkingRuntimeDefinition) {
        return (
          getBlockedRuntimeReason(
            checkingRuntimeDefinition.label,
            runtimeHealthByRuntime[checkingRuntimeDefinition.kind] ?? null,
          ) ?? "Checking runtime health..."
        );
      }
      return blockedRuntimeDefinition
        ? (describeRepoRuntimeStatus(
            blockedRuntimeDefinition.label,
            runtimeHealthByRuntime[blockedRuntimeDefinition.kind] ?? null,
          ) ?? "Checking runtime health...")
        : "Checking runtime health...";
    }

    if (checkingRuntimeDefinition) {
      return (
        getBlockedRuntimeReason(
          checkingRuntimeDefinition.label,
          runtimeHealthByRuntime[checkingRuntimeDefinition.kind] ?? null,
        ) ?? "Checking runtime health..."
      );
    }

    return (
      (blockedRuntimeDefinition
        ? getBlockedRuntimeReason(blockedRuntimeDefinition.label, blockedRuntimeHealth)
        : null) ??
      (runtimeDefinitions.length === 0
        ? "No agent runtimes are available."
        : "No configured runtime is ready for Agent Studio.")
    );
  })();

  return {
    agentStudioReadinessState,
    agentStudioReady,
    agentStudioBlockedReason,
    isLoadingChecks,
    refreshChecks,
  };
}
