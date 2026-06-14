import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { useEffect, useRef } from "react";
import { isSameSelection } from "@/features/session-start";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { resolveActiveSessionModelSelection } from "./model-selection-preferences";

export const useActiveSessionModelSelectionRepair = ({
  activeSession,
  activeSessionModelCatalog,
  activeSessionSelectedModel,
  roleDefaultSelection,
  updateAgentSessionModel,
}: {
  activeSession: AgentSessionIdentity | null;
  activeSessionModelCatalog: AgentModelCatalog | null;
  activeSessionSelectedModel: AgentModelSelection | null;
  roleDefaultSelection: AgentModelSelection | null;
  updateAgentSessionModel: (
    session: AgentSessionIdentity,
    selection: AgentModelSelection | null,
  ) => void;
}): void => {
  const lastRepairRef = useRef<{
    sessionKey: string;
    selection: AgentModelSelection;
  } | null>(null);

  useEffect(() => {
    if (!activeSession) {
      lastRepairRef.current = null;
      return;
    }
    const activeSessionKey = agentSessionIdentityKey(activeSession);
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
      lastRepairRef.current.sessionKey === activeSessionKey &&
      isSameSelection(lastRepairRef.current.selection, preferredSelection)
    ) {
      return;
    }
    lastRepairRef.current = {
      sessionKey: activeSessionKey,
      selection: preferredSelection,
    };
    updateAgentSessionModel(activeSession, preferredSelection);
  }, [
    activeSession,
    activeSessionModelCatalog,
    activeSessionSelectedModel,
    roleDefaultSelection,
    updateAgentSessionModel,
  ]);
};
