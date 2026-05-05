import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { useEffect, useRef } from "react";
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
  const lastRepairRef = useRef<{
    externalSessionId: string;
    selection: AgentModelSelection;
  } | null>(null);

  useEffect(() => {
    if (!activeExternalSessionId) {
      lastRepairRef.current = null;
      return;
    }
    const preferredSelection = resolveActiveSessionModelSelection({
      catalog: activeSessionModelCatalog,
      selectedModel: activeSessionSelectedModel,
      roleDefaultSelection,
    });
    if (!preferredSelection || isSameSelection(activeSessionSelectedModel, preferredSelection)) {
      lastRepairRef.current = null;
      return;
    }
    if (
      lastRepairRef.current &&
      lastRepairRef.current.externalSessionId === activeExternalSessionId &&
      isSameSelection(lastRepairRef.current.selection, preferredSelection)
    ) {
      return;
    }
    lastRepairRef.current = {
      externalSessionId: activeExternalSessionId,
      selection: preferredSelection,
    };
    updateAgentSessionModel(activeExternalSessionId, preferredSelection);
  }, [
    activeExternalSessionId,
    activeSessionModelCatalog,
    activeSessionSelectedModel,
    roleDefaultSelection,
    updateAgentSessionModel,
  ]);
};
