import type { AgentRole } from "@openducktor/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentStudioRightPanelKind,
  AgentStudioRightPanelModel,
  AgentStudioRightPanelToggleModel,
  AgentStudioWorkspaceSidebarModel,
} from "@/components/features/agents";
import type { AgentStudioGitPanelModel } from "@/components/features/agents/agent-studio-git-panel";
import { toRightPanelStorageKey } from "../agents-page-selection";

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
  build: true,
  qa: true,
};

const RIGHT_PANEL_ROLES: AgentRole[] = ["spec", "planner", "build", "qa"];

const cloneDefaultOpenByRole = (): Record<AgentRole, boolean> => ({
  ...DEFAULT_OPEN_BY_ROLE,
});

const readPersistedOpenByRole = (): Record<AgentRole, boolean> => {
  if (typeof globalThis.localStorage === "undefined") {
    return cloneDefaultOpenByRole();
  }

  const raw = globalThis.localStorage.getItem(toRightPanelStorageKey());
  if (!raw) {
    return cloneDefaultOpenByRole();
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const next = cloneDefaultOpenByRole();
    if (parsed && typeof parsed === "object") {
      for (const role of RIGHT_PANEL_ROLES) {
        const value = (parsed as Record<AgentRole, unknown>)[role];
        if (typeof value === "boolean") {
          next[role] = value;
        }
      }
    }
    return next;
  } catch {
    return cloneDefaultOpenByRole();
  }
};

const isRightPanelKindAvailable = (
  kind: AgentStudioRightPanelKind,
  availability: { hasDocumentPanel: boolean; hasDiffPanel: boolean },
): boolean => {
  if (kind === "documents") {
    return availability.hasDocumentPanel;
  }
  return availability.hasDiffPanel;
};

type BuildAgentStudioRightPanelModelInput = {
  panelKind: AgentStudioRightPanelKind | null;
  documentsModel: AgentStudioWorkspaceSidebarModel;
  diffModel: AgentStudioGitPanelModel;
};

export const buildAgentStudioRightPanelModel = ({
  panelKind,
  documentsModel,
  diffModel,
}: BuildAgentStudioRightPanelModelInput): AgentStudioRightPanelModel | null => {
  if (!panelKind) {
    return null;
  }

  if (panelKind === "documents") {
    return {
      kind: "documents",
      documentsModel,
    };
  }

  return {
    kind: "diff",
    documentsModel,
    diffModel,
  };
};

export function useAgentStudioRightPanel({
  role,
  hasDocumentPanel,
  hasDiffPanel = false,
  hasTaskContext = true,
}: UseAgentStudioRightPanelInput): UseAgentStudioRightPanelState {
  const [isOpenByRole, setIsOpenByRole] = useState<Record<AgentRole, boolean>>(() => {
    if (typeof globalThis.localStorage === "undefined") {
      return cloneDefaultOpenByRole();
    }

    return readPersistedOpenByRole();
  });

  useEffect(() => {
    if (typeof globalThis.localStorage === "undefined") {
      return;
    }

    globalThis.localStorage.setItem(toRightPanelStorageKey(), JSON.stringify(isOpenByRole));
  }, [isOpenByRole]);

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
