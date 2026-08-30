import type { AgentModelCatalog } from "@openducktor/core";
import { useMemo } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  type AgentStudioContextUsage,
  type ExtractLatestSessionContextUsageInput,
  extractLatestSessionContextUsage,
  indexModelDescriptorsByProviderAndModel,
} from "./context-usage-resolution";

export const useSelectedSessionContextUsage = ({
  selectedSession,
  sessionModelCatalog,
  selectedModelEntry,
}: {
  selectedSession: AgentSessionState | null;
  sessionModelCatalog: AgentModelCatalog | null;
  selectedModelEntry: AgentModelCatalog["models"][number] | null;
}): AgentStudioContextUsage => {
  const selectedSessionModelDescriptorByKey = useMemo(() => {
    return indexModelDescriptorsByProviderAndModel(sessionModelCatalog ?? null);
  }, [sessionModelCatalog]);

  return useMemo<AgentStudioContextUsage>(() => {
    const fallbackContextWindow = selectedModelEntry?.contextWindow ?? null;
    const fallbackOutputLimit = selectedModelEntry?.outputLimit ?? null;
    const contextUsageInput: ExtractLatestSessionContextUsageInput = {
      liveContextUsage: selectedSession?.contextUsage ?? null,
      modelDescriptorByKey: selectedSessionModelDescriptorByKey,
    };
    if (fallbackContextWindow !== null) {
      contextUsageInput.fallbackContextWindow = fallbackContextWindow;
    }
    if (fallbackOutputLimit !== null) {
      contextUsageInput.fallbackOutputLimit = fallbackOutputLimit;
    }
    return extractLatestSessionContextUsage(contextUsageInput);
  }, [
    selectedSession,
    selectedSessionModelDescriptorByKey,
    selectedModelEntry?.contextWindow,
    selectedModelEntry?.outputLimit,
  ]);
};
