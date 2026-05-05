import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { useEffect } from "react";
import { isSameSelection } from "@/features/session-start";
import { resolveActiveSessionModelSelection } from "./model-selection-preferences";

export const useActiveSessionModelSelectionRepair = ({
  activeExternalSessionId,
  activeSessionModelCatalog,
  activeSessionSelectedModel,
  roleDefaultSelection,
  updateAgentSessionModel,
}: {
  activeExternalSessionId: string | null;
  activeSessionModelCatalog: AgentModelCatalog | null;
  activeSessionSelectedModel: AgentModelSelection | null;
  roleDefaultSelection: AgentModelSelection | null;
  updateAgentSessionModel: (
    externalSessionId: string,
    selection: AgentModelSelection | null,
  ) => void;
}): void => {
  useEffect(() => {
    if (!activeExternalSessionId) {
      return;
    }
    const preferredSelection = resolveActiveSessionModelSelection({
      catalog: activeSessionModelCatalog,
      selectedModel: activeSessionSelectedModel,
      roleDefaultSelection,
    });
    if (!preferredSelection || isSameSelection(activeSessionSelectedModel, preferredSelection)) {
      return;
    }
    updateAgentSessionModel(activeExternalSessionId, preferredSelection);
  }, [
    activeExternalSessionId,
    activeSessionModelCatalog,
    activeSessionSelectedModel,
    roleDefaultSelection,
    updateAgentSessionModel,
  ]);
};
