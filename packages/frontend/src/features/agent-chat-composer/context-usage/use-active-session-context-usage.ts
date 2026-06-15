import type { AgentModelCatalog } from "@openducktor/core";
import { useMemo } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  type AgentStudioContextUsage,
  extractLatestSessionContextUsage,
  indexModelDescriptorsByProviderAndModel,
} from "./context-usage-resolution";

export const useActiveSessionContextUsage = ({
  activeSession,
  activeSessionModelCatalog,
  selectedModelEntry,
}: {
  activeSession: AgentSessionState | null;
  activeSessionModelCatalog: AgentModelCatalog | null;
  selectedModelEntry: AgentModelCatalog["models"][number] | null;
}): AgentStudioContextUsage => {
  const activeSessionModelDescriptorByKey = useMemo(() => {
    return indexModelDescriptorsByProviderAndModel(activeSessionModelCatalog ?? null);
  }, [activeSessionModelCatalog]);

  return useMemo<AgentStudioContextUsage>(() => {
    const fallbackContextWindow =
      typeof selectedModelEntry?.contextWindow === "number"
        ? selectedModelEntry.contextWindow
        : null;
    const fallbackOutputLimit =
      typeof selectedModelEntry?.outputLimit === "number" ? selectedModelEntry.outputLimit : null;

    return extractLatestSessionContextUsage({
      session: activeSession,
      liveContextUsage: activeSession?.contextUsage ?? null,
      modelDescriptorByKey: activeSessionModelDescriptorByKey,
      ...(fallbackContextWindow !== null ? { fallbackContextWindow } : {}),
      ...(fallbackOutputLimit !== null ? { fallbackOutputLimit } : {}),
    });
  }, [
    activeSession,
    activeSessionModelDescriptorByKey,
    selectedModelEntry?.contextWindow,
    selectedModelEntry?.outputLimit,
  ]);
};
