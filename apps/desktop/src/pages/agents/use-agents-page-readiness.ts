import { useRepoRuntimeReadiness } from "@/components/features/agents/agent-chat/use-repo-runtime-readiness";
import type { useChecksState } from "@/state";
import type { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { AgentStudioOrchestrationReadinessContext } from "./use-agent-studio-orchestration-controller";

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
  const readiness = useRepoRuntimeReadiness({
    activeWorkspace,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks,
    refreshChecks,
  });

  return {
    agentStudioReadinessState: readiness.readinessState,
    agentStudioReady: readiness.isReady,
    agentStudioBlockedReason: readiness.blockedReason,
    isLoadingChecks: readiness.isLoadingChecks,
    refreshChecks: readiness.refreshChecks,
  };
}
