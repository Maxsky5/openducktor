import type { AgentModelCatalog } from "@openducktor/core";
import { useMemo } from "react";
import type { AgentSessionContextUsage } from "../../../types/agent-orchestrator";
import {
  type AgentStudioContextUsage,
  type ExtractLatestSessionContextUsageInput,
  extractLatestSessionContextUsage,
  indexModelDescriptorsByProviderAndModel,
} from "./context-usage-resolution";

/**
 * Session Context Usage: the latest usage that the runtime reported, against the context window
 * of its model. The selected model entry gives the window and output limit when the runtime and
 * the catalog give none. Null until the runtime reports usage and the window size is known.
 */
export const useSelectedSessionContextUsage = ({
  contextUsage,
  catalog,
  selectedModelEntry,
}: {
  /** The usage of the session. A session that has not reported one leaves it out. */
  contextUsage: AgentSessionContextUsage | null | undefined;
  catalog: AgentModelCatalog | null;
  selectedModelEntry: AgentModelCatalog["models"][number] | null;
}): AgentStudioContextUsage => {
  const modelDescriptorByKey = useMemo(
    () => indexModelDescriptorsByProviderAndModel(catalog),
    [catalog],
  );
  const fallbackContextWindow = selectedModelEntry?.contextWindow ?? null;
  const fallbackOutputLimit = selectedModelEntry?.outputLimit ?? null;

  return useMemo<AgentStudioContextUsage>(() => {
    const input: ExtractLatestSessionContextUsageInput = {
      liveContextUsage: contextUsage ?? null,
      modelDescriptorByKey,
    };
    if (fallbackContextWindow !== null) input.fallbackContextWindow = fallbackContextWindow;
    if (fallbackOutputLimit !== null) input.fallbackOutputLimit = fallbackOutputLimit;
    return extractLatestSessionContextUsage(input);
  }, [contextUsage, fallbackContextWindow, fallbackOutputLimit, modelDescriptorByKey]);
};
