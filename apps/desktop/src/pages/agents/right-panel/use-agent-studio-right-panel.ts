import type { AgentRole } from "@openducktor/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentStudioRightPanelKind,
  AgentStudioRightPanelModel,
  AgentStudioRightPanelToggleModel,
} from "@/components/features/agents";
import type { AgentStudioDevServerPanelModel } from "@/components/features/agents/agent-studio-dev-server-panel";
import type { AgentStudioGitPanelModel } from "@/components/features/agents/agent-studio-git-panel";
import type { AgentStudioWorkspaceSidebarModel } from "@/components/features/agents/agent-studio-workspace-sidebar";
import { toRightPanelStorageKey } from "../agents-page-selection";

type UseAgentStudioRightPanelInput = {
  role: AgentRole;
  hasDocumentPanel: boolean;
  hasBuildToolsPanel?: boolean;
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
  build: "build_tools",
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

const readPersistedRightPanelPayload = (): Record<string, unknown> | null => {
  if (typeof globalThis.localStorage === "undefined") {
    return null;
  }

  const raw = globalThis.localStorage.getItem(toRightPanelStorageKey());
  if (!raw) {
    return null;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  return parsed as Record<string, unknown>;
};

const readPersistedOpenByRole = (): Record<AgentRole, boolean> => {
  if (typeof globalThis.localStorage === "undefined") {
    return cloneDefaultOpenByRole();
  }

  try {
    const parsed = readPersistedRightPanelPayload();
    const next = cloneDefaultOpenByRole();
    if (parsed) {
      for (const role of RIGHT_PANEL_ROLES) {
        const value = parsed[role];
        if (typeof value === "boolean") {
          next[role] = value;
        }
      }
    }
    return next;
  } catch (error) {
    console.error("[agent-studio-right-panel] Failed to parse persisted panel state.", {
      raw: globalThis.localStorage.getItem(toRightPanelStorageKey()),
      error,
    });
    return cloneDefaultOpenByRole();
  }
};

const isRightPanelKindAvailable = (
  kind: AgentStudioRightPanelKind,
  availability: { hasDocumentPanel: boolean; hasBuildToolsPanel: boolean },
): boolean => {
  if (kind === "documents") {
    return availability.hasDocumentPanel;
  }
  return availability.hasBuildToolsPanel;
};

type BuildAgentStudioRightPanelModelInput = {
  panelKind: AgentStudioRightPanelKind | null;
  documentsModel: AgentStudioWorkspaceSidebarModel;
  diffModel: AgentStudioGitPanelModel;
  devServerModel: AgentStudioDevServerPanelModel;
};

export const buildAgentStudioRightPanelModel = ({
  panelKind,
  documentsModel,
  diffModel,
  devServerModel,
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
    kind: "build_tools",
    diffModel,
    devServerModel,
  };
};

export function useAgentStudioRightPanel({
  role,
  hasDocumentPanel,
  hasBuildToolsPanel = false,
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

    try {
      const persisted = readPersistedRightPanelPayload();
      const nextValue = persisted ? { ...persisted, ...isOpenByRole } : isOpenByRole;
      globalThis.localStorage.setItem(toRightPanelStorageKey(), JSON.stringify(nextValue));
    } catch (error) {
      console.error("[agent-studio-right-panel] Failed to persist panel state.", {
        nextState: isOpenByRole,
        error,
      });
    }
  }, [isOpenByRole]);

  const panelKindForRole = PANEL_KIND_BY_ROLE[role];
  const panelAvailable =
    hasTaskContext &&
    isRightPanelKindAvailable(panelKindForRole, {
      hasDocumentPanel,
      hasBuildToolsPanel,
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
