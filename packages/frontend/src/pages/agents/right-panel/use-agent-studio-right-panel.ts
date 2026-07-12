import type { AgentRole } from "@openducktor/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  TaskExecutionFileExplorerPanelModel,
  TaskExecutionPanelModel,
  TaskExecutionPanelTab,
  TaskExecutionPanelTabId,
  TaskExecutionPanelToggleModel,
} from "@/components/features/agents";
import type { AgentStudioDevServerPanelModel } from "@/components/features/agents/agent-studio-dev-server-panel";
import type { AgentStudioGitPanelModel } from "@/components/features/agents/agent-studio-git-panel";
import type { TaskExecutionCiChecksPanelModel } from "@/components/features/agents/task-execution-ci-checks-panel";
import type { TaskExecutionDocumentPanelModel } from "@/components/features/agents/task-execution-document-panel";
import { toRightPanelStorageKey } from "../agents-page-selection";

type UseAgentStudioRightPanelInput = {
  role: AgentRole;
  hasDocumentPanel: boolean;
  hasGithubIntegration: boolean;
  hasLinkedGithubPullRequest: boolean;
  hasTaskContext?: boolean;
};

type UseAgentStudioRightPanelState = {
  activeTabId: TaskExecutionPanelTabId | null;
  tabs: TaskExecutionPanelTab[];
  isPanelOpen: boolean;
  onActiveTabChange: (tabId: TaskExecutionPanelTabId) => void;
  rightPanelToggleModel: TaskExecutionPanelToggleModel | null;
};

const DEFAULT_OPEN_BY_ROLE: Record<AgentRole, boolean> = {
  spec: true,
  planner: true,
  build: true,
  qa: true,
};

const RIGHT_PANEL_ROLES: AgentRole[] = ["spec", "planner", "build", "qa"];
const DEFAULT_ACTIVE_TAB_BY_ROLE: Record<AgentRole, TaskExecutionPanelTabId> = {
  spec: "document",
  planner: "document",
  build: "git",
  qa: "document",
};

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

const buildTaskExecutionTabs = ({
  hasDocumentPanel,
  hasGithubIntegration,
  hasLinkedGithubPullRequest,
}: {
  hasDocumentPanel: boolean;
  hasGithubIntegration: boolean;
  hasLinkedGithubPullRequest: boolean;
}): TaskExecutionPanelTab[] => {
  const tabs: TaskExecutionPanelTab[] = [];
  if (hasDocumentPanel) {
    tabs.push({ id: "document", label: "Document" });
  }
  tabs.push({ id: "git", label: "Git" });
  tabs.push({ id: "file_explorer", label: "File explorer" });
  if (hasGithubIntegration && hasLinkedGithubPullRequest) {
    tabs.push({ id: "ci_checks", label: "CI Checks" });
  }
  return tabs;
};

const resolveActiveTab = ({
  role,
  requestedTab,
  tabs,
}: {
  role: AgentRole;
  requestedTab: TaskExecutionPanelTabId;
  tabs: TaskExecutionPanelTab[];
}): TaskExecutionPanelTabId | null => {
  if (tabs.length === 0) {
    return null;
  }
  if (tabs.some((tab) => tab.id === requestedTab)) {
    return requestedTab;
  }
  const roleDefault = DEFAULT_ACTIVE_TAB_BY_ROLE[role];
  const fallbackTab = tabs.find((tab) => tab.id === roleDefault) ?? tabs[0];
  return fallbackTab?.id ?? null;
};

type BuildTaskExecutionPanelModelInput = {
  tabs: TaskExecutionPanelTab[];
  activeTabId: TaskExecutionPanelTabId | null;
  documentModel: TaskExecutionDocumentPanelModel | null;
  diffModel: AgentStudioGitPanelModel;
  fileExplorerModel: TaskExecutionFileExplorerPanelModel;
  ciChecksModel: TaskExecutionCiChecksPanelModel | null;
  devServerModel: AgentStudioDevServerPanelModel | null;
  onActiveTabChange: (tabId: TaskExecutionPanelTabId) => void;
};

export const buildTaskExecutionPanelModel = ({
  tabs,
  activeTabId,
  documentModel,
  diffModel,
  fileExplorerModel,
  ciChecksModel,
  devServerModel,
  onActiveTabChange,
}: BuildTaskExecutionPanelModelInput): TaskExecutionPanelModel | null => {
  if (!activeTabId || tabs.length === 0) {
    return null;
  }

  return {
    tabs,
    activeTabId,
    onActiveTabChange,
    documentModel,
    gitModel: diffModel,
    fileExplorerModel,
    ciChecksModel,
    devServerModel,
  };
};

export function useAgentStudioRightPanel({
  role,
  hasDocumentPanel,
  hasGithubIntegration,
  hasLinkedGithubPullRequest,
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

  const [requestedTabByRole, setRequestedTabByRole] = useState<
    Record<AgentRole, TaskExecutionPanelTabId>
  >(() => ({
    ...DEFAULT_ACTIVE_TAB_BY_ROLE,
  }));
  const tabs = useMemo(
    () =>
      hasTaskContext
        ? buildTaskExecutionTabs({
            hasDocumentPanel,
            hasGithubIntegration,
            hasLinkedGithubPullRequest,
          })
        : [],
    [hasDocumentPanel, hasGithubIntegration, hasLinkedGithubPullRequest, hasTaskContext],
  );
  const activeTabId = resolveActiveTab({
    role,
    requestedTab: requestedTabByRole[role],
    tabs,
  });
  const isPanelOpen = activeTabId ? isOpenByRole[role] : false;

  const handleTogglePanel = useCallback(() => {
    setIsOpenByRole((current) => ({
      ...current,
      [role]: !current[role],
    }));
  }, [role]);

  const handleActiveTabChange = useCallback(
    (tabId: TaskExecutionPanelTabId) => {
      setRequestedTabByRole((current) => ({
        ...current,
        [role]: tabId,
      }));
    },
    [role],
  );

  const rightPanelToggleModel = useMemo<TaskExecutionPanelToggleModel | null>(() => {
    if (!activeTabId) {
      return null;
    }

    return {
      kind: "task_execution",
      isOpen: isPanelOpen,
      onToggle: handleTogglePanel,
    };
  }, [activeTabId, handleTogglePanel, isPanelOpen]);

  return {
    activeTabId,
    tabs,
    isPanelOpen,
    rightPanelToggleModel,
    onActiveTabChange: handleActiveTabChange,
  };
}
