import { hasRuntimeType } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useMemo } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  type AgentStudioContextUsage,
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
    const fallbackContextWindow = hasRuntimeType(selectedModelEntry?.contextWindow, "number")
      ? selectedModelEntry.contextWindow
      : null;
    const fallbackOutputLimit = hasRuntimeType(selectedModelEntry?.outputLimit, "number")
      ? selectedModelEntry.outputLimit
      : null;

    return extractLatestSessionContextUsage({
      liveContextUsage: selectedSession?.contextUsage ?? null,
      modelDescriptorByKey: selectedSessionModelDescriptorByKey,
      ...(fallbackContextWindow !== null ? { fallbackContextWindow } : undefined),
      ...(fallbackOutputLimit !== null ? { fallbackOutputLimit } : undefined),
    });
  }, [
    selectedSession,
    selectedSessionModelDescriptorByKey,
    selectedModelEntry?.contextWindow,
    selectedModelEntry?.outputLimit,
  ]);
};
