import type { AgentRole } from "@openducktor/core";
import { useCallback, useMemo, useState } from "react";
import type {
  AgentStudioRightPanelKind,
  AgentStudioRightPanelToggleModel,
} from "@/components/features/agents";

type UseAgentStudioRightPanelInput = {
  role: AgentRole;
  hasDocumentPanel: boolean;
  hasDiffPanel?: boolean;
  hasTaskContext?: boolean;
};

type UseAgentStudioRightPanelState = {
  panelKind: AgentStudioRightPanelKind | null;
  isPanelOpen: boolean;
  rightPanelToggleModel: AgentStudioRightPanelToggleModel | null;
};

const PANEL_KIND_BY_ROLE: Record<AgentRole, AgentStudioRightPanelKind> = {
  spec: "documents",
  planner: "documents",
  build: "diff",
  qa: "documents",
};

const DEFAULT_OPEN_BY_ROLE: Record<AgentRole, boolean> = {
  spec: true,
  planner: true,
  build: false,
  qa: true,
};

export const isRightPanelKindAvailable = (
  kind: AgentStudioRightPanelKind,
  availability: { hasDocumentPanel: boolean; hasDiffPanel: boolean },
): boolean => {
  if (kind === "documents") {
    return availability.hasDocumentPanel;
  }
  return availability.hasDiffPanel;
};

export function useAgentStudioRightPanel({
  role,
  hasDocumentPanel,
  hasDiffPanel = false,
  hasTaskContext = true,
}: UseAgentStudioRightPanelInput): UseAgentStudioRightPanelState {
  const [isOpenByRole, setIsOpenByRole] =
    useState<Record<AgentRole, boolean>>(DEFAULT_OPEN_BY_ROLE);

  const panelKindForRole = PANEL_KIND_BY_ROLE[role];
  const panelAvailable =
    hasTaskContext &&
    isRightPanelKindAvailable(panelKindForRole, {
      hasDocumentPanel,
      hasDiffPanel,
    });
  const panelKind = panelAvailable ? panelKindForRole : null;
  const isPanelOpen = panelKind ? isOpenByRole[role] : false;

  const handleTogglePanel = useCallback(() => {
    setIsOpenByRole((current) => ({
      ...current,
      [role]: !current[role],
    }));
  }, [role]);

  const rightPanelToggleModel = useMemo<AgentStudioRightPanelToggleModel | null>(() => {
    if (!panelKind) {
      return null;
    }

    return {
      kind: panelKind,
      isOpen: isPanelOpen,
      onToggle: handleTogglePanel,
    };
  }, [handleTogglePanel, isPanelOpen, panelKind]);

  return {
    panelKind,
    isPanelOpen,
    rightPanelToggleModel,
  };
}
