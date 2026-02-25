import type { AgentRole } from "@openducktor/core";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AgentChat,
  AgentStudioHeader,
  AgentStudioTaskTabs,
  AgentStudioWorkspaceSidebar,
} from "@/components/features/agents";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useAgentState, useChecksState, useTasksState, useWorkspaceState } from "@/state";
import { firstScenario, SCENARIOS_BY_ROLE } from "./agents-page-constants";
import { resolveAgentStudioActiveSession, resolveAgentStudioTaskId } from "./agents-page-selection";
import { buildLatestSessionByTaskMap } from "./agents-page-session-tabs";
import { useAgentSessionPermissionActions } from "./use-agent-session-permission-actions";
import { useAgentStudioDocuments } from "./use-agent-studio-documents";
import { useAgentStudioModelSelection } from "./use-agent-studio-model-selection";
import { useAgentStudioPageModels } from "./use-agent-studio-page-models";
import { useAgentStudioQuerySync } from "./use-agent-studio-query-sync";
import { useAgentStudioRepoSettings } from "./use-agent-studio-repo-settings";
import { useAgentStudioSessionActions } from "./use-agent-studio-session-actions";
import { useAgentStudioTaskHydration } from "./use-agent-studio-task-hydration";
import { useAgentStudioTaskTabs } from "./use-agent-studio-task-tabs";

export function AgentsPage(): ReactElement {
  const { activeRepo, loadRepoSettings } = useWorkspaceState();
  const { opencodeHealth, isLoadingChecks, refreshChecks } = useChecksState();
  const { isLoadingTasks, tasks } = useTasksState();
  const {
    sessions,
    loadAgentSessions,
    startAgentSession,
    sendAgentMessage,
    stopAgentSession,
    updateAgentSessionModel,
    replyAgentPermission,
    answerAgentQuestion,
  } = useAgentState();

  const [searchParams, setSearchParams] = useSearchParams();
  const [input, setInput] = useState("");

  const {
    taskIdParam,
    sessionParam,
    hasExplicitRoleParam,
    roleFromQuery,
    scenarioFromQuery,
    autostart,
    sessionStartPreference,
    updateQuery,
  } = useAgentStudioQuerySync({
    activeRepo,
    searchParams,
    setSearchParams,
  });

  const selectedSessionById = useMemo(
    () => sessions.find((entry) => entry.sessionId === sessionParam) ?? null,
    [sessionParam, sessions],
  );

  const taskId = resolveAgentStudioTaskId({
    taskIdParam,
    selectedSessionById,
  });
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === taskId) ?? null,
    [taskId, tasks],
  );

  const sessionsForTask = useMemo(() => {
    return sessions
      .filter((entry) => entry.taskId === taskId)
      .sort((a, b) => {
        if (a.startedAt !== b.startedAt) {
          return a.startedAt > b.startedAt ? -1 : 1;
        }
        if (a.sessionId === b.sessionId) {
          return 0;
        }
        return a.sessionId > b.sessionId ? -1 : 1;
      });
  }, [sessions, taskId]);

  const activeSession = useMemo(() => {
    return resolveAgentStudioActiveSession({
      sessionsForTask,
      sessionParam,
      hasExplicitRoleParam,
      roleFromQuery,
      sessionStartPreference,
    });
  }, [hasExplicitRoleParam, roleFromQuery, sessionStartPreference, sessionParam, sessionsForTask]);

  const role: AgentRole = roleFromQuery;
  const scenarios = SCENARIOS_BY_ROLE[role];
  const scenario =
    scenarioFromQuery && scenarios.includes(scenarioFromQuery)
      ? scenarioFromQuery
      : firstScenario(role);

  const agentStudioReady = Boolean(
    activeRepo && opencodeHealth?.runtimeOk && opencodeHealth?.mcpOk,
  );
  const agentStudioBlockedReason = !activeRepo
    ? "Select a repository to use Agent Studio."
    : opencodeHealth?.runtimeError
      ? opencodeHealth.runtimeError
      : opencodeHealth?.mcpError
        ? opencodeHealth.mcpError
        : isLoadingChecks
          ? "Checking OpenCode and OpenDucktor MCP health..."
          : "OpenCode runtime or OpenDucktor MCP is not ready.";

  const contextSessions = sessionsForTask;
  const sessionByTaskId = useMemo(() => buildLatestSessionByTaskMap(sessions), [sessions]);

  const clearComposerInput = useCallback((): void => {
    setInput("");
  }, []);

  const {
    tabTaskIds,
    availableTabTasks,
    taskTabs,
    handleSelectTab,
    handleCreateTab,
    handleCloseTab,
  } = useAgentStudioTaskTabs({
    activeRepo,
    taskId,
    selectedTask,
    tasks,
    isLoadingTasks,
    latestSessionByTaskId: sessionByTaskId,
    updateQuery,
    clearComposerInput,
  });

  const hydratedTasksByRepoAndTask = useAgentStudioTaskHydration({
    activeRepo,
    activeTaskId: taskId,
    tabTaskIds,
    loadAgentSessions,
  });

  const taskHydrationKey = activeRepo && taskId ? `${activeRepo}:${taskId}` : "";
  const isActiveTaskHydrated = taskHydrationKey
    ? (hydratedTasksByRepoAndTask[taskHydrationKey] ?? false)
    : false;

  useEffect(() => {
    if (isLoadingTasks) {
      return;
    }
    if (!taskIdParam || selectedSessionById) {
      return;
    }
    if (tasks.some((entry) => entry.id === taskIdParam)) {
      return;
    }
    updateQuery({
      task: undefined,
      session: undefined,
      agent: undefined,
      scenario: undefined,
      autostart: undefined,
      start: undefined,
    });
  }, [isLoadingTasks, selectedSessionById, taskIdParam, tasks, updateQuery]);

  useEffect(() => {
    if (!selectedSessionById || taskIdParam) {
      return;
    }
    updateQuery({ task: selectedSessionById.taskId });
  }, [selectedSessionById, taskIdParam, updateQuery]);

  useEffect(() => {
    if (!sessionParam) {
      return;
    }
    if (selectedSessionById && taskId && selectedSessionById.taskId !== taskId) {
      updateQuery({ session: undefined });
      return;
    }
    if (!taskId || !isActiveTaskHydrated) {
      return;
    }
    if (selectedSessionById && selectedSessionById.taskId === taskId) {
      return;
    }
    updateQuery({ session: undefined });
  }, [isActiveTaskHydrated, selectedSessionById, sessionParam, taskId, updateQuery]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    const updates: Record<string, string | undefined> = {};
    if (taskIdParam !== activeSession.taskId) {
      updates.task = activeSession.taskId;
    }
    if (sessionParam !== activeSession.sessionId) {
      updates.session = activeSession.sessionId;
    }
    if (roleFromQuery !== activeSession.role) {
      updates.agent = activeSession.role;
    }
    if (scenarioFromQuery !== activeSession.scenario) {
      updates.scenario = activeSession.scenario;
    }
    if (autostart) {
      updates.autostart = undefined;
    }
    if (sessionStartPreference) {
      updates.start = undefined;
    }

    if (Object.keys(updates).length === 0) {
      return;
    }
    updateQuery(updates);
  }, [
    activeSession,
    autostart,
    roleFromQuery,
    scenarioFromQuery,
    sessionParam,
    sessionStartPreference,
    taskIdParam,
    updateQuery,
  ]);

  const { repoSettings } = useAgentStudioRepoSettings({
    activeRepo,
    loadRepoSettings,
  });

  const { specDoc, planDoc, qaDoc } = useAgentStudioDocuments({
    taskId,
    activeSession,
    selectedTask,
  });

  const {
    selectionForNewSession,
    selectedModelSelection,
    isSelectionCatalogLoading,
    agentOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    activeSessionAgentColors,
    activeSessionContextUsage,
    handleSelectAgent,
    handleSelectModel,
    handleSelectVariant,
  } = useAgentStudioModelSelection({
    activeRepo,
    activeSession,
    role,
    repoSettings,
    updateAgentSessionModel,
  });

  const {
    isStarting,
    isSending,
    isSubmittingQuestionByRequestId,
    isSessionWorking,
    canKickoffNewSession,
    kickoffLabel,
    canStopSession,
    startScenarioKickoff,
    onSend,
    onSubmitQuestionAnswers,
    handleWorkflowStepSelect,
    handleSessionSelectionChange,
    handleCreateSession,
  } = useAgentStudioSessionActions({
    activeRepo,
    taskId,
    role,
    scenario,
    autostart,
    sessionStartPreference,
    activeSession,
    sessionsForTask,
    selectedTask,
    agentStudioReady,
    isActiveTaskHydrated,
    selectionForNewSession,
    input,
    setInput,
    startAgentSession,
    sendAgentMessage,
    updateAgentSessionModel,
    answerAgentQuestion,
    updateQuery,
  });

  const { isSubmittingPermissionByRequestId, permissionReplyErrorByRequestId, onReplyPermission } =
    useAgentSessionPermissionActions({
      activeSessionId: activeSession?.sessionId ?? null,
      pendingPermissions: activeSession?.pendingPermissions ?? [],
      agentStudioReady,
      replyAgentPermission,
    });

  const {
    activeTabValue,
    agentStudioTaskTabsModel,
    agentStudioHeaderModel,
    agentStudioWorkspaceSidebarModel,
    agentChatModel,
  } = useAgentStudioPageModels({
    taskId,
    role,
    selectedTask,
    sessionsForTask,
    contextSessionsLength: contextSessions.length,
    activeSession,
    taskTabs,
    availableTabTasks,
    isLoadingTasks,
    onCreateTab: handleCreateTab,
    onCloseTab: handleCloseTab,
    handleWorkflowStepSelect,
    handleSessionSelectionChange,
    handleCreateSession,
    specDoc,
    planDoc,
    qaDoc,
    agentStudioReady,
    agentStudioBlockedReason,
    isLoadingChecks,
    refreshChecks,
    isStarting,
    isSending,
    isSessionWorking,
    canKickoffNewSession,
    kickoffLabel,
    canStopSession,
    startScenarioKickoff,
    onSend,
    onSubmitQuestionAnswers,
    isSubmittingQuestionByRequestId,
    selectedModelSelection,
    isSelectionCatalogLoading,
    agentOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    onSelectAgent: handleSelectAgent,
    onSelectModel: handleSelectModel,
    onSelectVariant: handleSelectVariant,
    activeSessionAgentColors,
    activeSessionContextUsage,
    isSubmittingPermissionByRequestId,
    permissionReplyErrorByRequestId,
    onReplyPermission,
    input,
    setInput,
    stopAgentSession,
  });

  return (
    <Tabs
      value={activeTabValue}
      onValueChange={handleSelectTab}
      className="h-[calc(100vh-2rem)] min-h-0 max-h-[calc(100vh-2rem)] shadow-lg rounded-xl gap-0 overflow-hidden"
    >
      <AgentStudioTaskTabs model={agentStudioTaskTabsModel} />

      <TabsContent value={activeTabValue} className="m-0 min-h-0 flex-1 bg-white p-0">
        {taskId ? (
          <ResizablePanelGroup direction="horizontal" className="h-full min-h-0 overflow-hidden">
            <ResizablePanel defaultSize={63} minSize={35}>
              <AgentChat
                header={<AgentStudioHeader model={agentStudioHeaderModel} />}
                model={agentChatModel}
              />
            </ResizablePanel>
            {agentStudioWorkspaceSidebarModel.activeDocument ? (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={37} minSize={30}>
                  <AgentStudioWorkspaceSidebar model={agentStudioWorkspaceSidebarModel} />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        ) : (
          <div className="flex h-full min-h-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-500">
            Open a task tab to start a workspace.
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
