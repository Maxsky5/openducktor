import type { AgentModelCatalog } from "@openducktor/core";
import { useMemo } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  type AgentStudioContextUsage,
  type ExtractLatestSessionContextUsageInput,
  extractLatestSessionContextUsage,
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
  return useMemo<AgentStudioContextUsage>(() => {
    const fallbackContextWindow = selectedModelEntry?.contextWindow ?? null;
    const fallbackOutputLimit = selectedModelEntry?.outputLimit ?? null;
    const contextUsageInput: ExtractLatestSessionContextUsageInput = {
      liveContextUsage: selectedSession?.contextUsage ?? null,
      catalog: sessionModelCatalog,
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
    sessionModelCatalog,
    selectedModelEntry?.contextWindow,
    selectedModelEntry?.outputLimit,
  ]);
};
