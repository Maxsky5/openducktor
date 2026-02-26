import type { AgentRole } from "@openducktor/core";
import {
  type ReactElement,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  AgentChat,
  AgentStudioHeader,
  AgentStudioRightPanel,
  AgentStudioTaskTabs,
} from "@/components/features/agents";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useAgentState, useChecksState, useTasksState, useWorkspaceState } from "@/state";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { firstScenario, SCENARIOS_BY_ROLE } from "./agents-page-constants";
import { resolveAgentStudioActiveSession, resolveAgentStudioTaskId } from "./agents-page-selection";
import { useAgentSessionPermissionActions } from "./use-agent-session-permission-actions";
import { useAgentStudioDocuments } from "./use-agent-studio-documents";
import { useAgentStudioModelSelection } from "./use-agent-studio-model-selection";
import { useAgentStudioPageModels } from "./use-agent-studio-page-models";
import { useAgentStudioQuerySync } from "./use-agent-studio-query-sync";
import { useAgentStudioRepoSettings } from "./use-agent-studio-repo-settings";
import { useAgentStudioRightPanel } from "./use-agent-studio-right-panel";
import { useAgentStudioSessionActions } from "./use-agent-studio-session-actions";
import { useAgentStudioTaskHydration } from "./use-agent-studio-task-hydration";
import { useAgentStudioTaskTabs } from "./use-agent-studio-task-tabs";

const compareSessionsByRecency = (left: AgentSessionState, right: AgentSessionState): number => {
  if (left.startedAt !== right.startedAt) {
    return left.startedAt > right.startedAt ? -1 : 1;
  }
  if (left.sessionId === right.sessionId) {
    return 0;
  }
  return left.sessionId > right.sessionId ? -1 : 1;
};

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
  const [contextSwitchVersion, setContextSwitchVersion] = useState(0);

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

  const scheduleQueryUpdate = useCallback(
    (updates: Record<string, string | undefined>): void => {
      startTransition(() => {
        updateQuery(updates);
      });
    },
    [updateQuery],
  );

  const tasksById = useMemo(() => {
    return new Map(tasks.map((task) => [task.id, task]));
  }, [tasks]);

  const sessionsById = useMemo(() => {
    return new Map(sessions.map((session) => [session.sessionId, session]));
  }, [sessions]);

  const sessionsByTaskId = useMemo(() => {
    const grouped = new Map<string, AgentSessionState[]>();
    for (const session of sessions) {
      const current = grouped.get(session.taskId);
      if (current) {
        current.push(session);
      } else {
        grouped.set(session.taskId, [session]);
      }
    }
    for (const group of grouped.values()) {
      group.sort(compareSessionsByRecency);
    }
    return grouped;
  }, [sessions]);

  const selectedSessionById = useMemo(
    () => (sessionParam ? (sessionsById.get(sessionParam) ?? null) : null),
    [sessionParam, sessionsById],
  );

  const taskId = resolveAgentStudioTaskId({
    taskIdParam,
    selectedSessionById,
  });
  const selectedTask = useMemo(
    () => (taskId ? (tasksById.get(taskId) ?? null) : null),
    [taskId, tasksById],
  );

  const sessionsForTask = useMemo(() => {
    if (!taskId) {
      return [];
    }
    return sessionsByTaskId.get(taskId) ?? [];
  }, [sessionsByTaskId, taskId]);

  const activeSession = useMemo(() => {
    return resolveAgentStudioActiveSession({
      sessionsForTask,
      sessionParam,
      hasExplicitRoleParam,
      roleFromQuery,
      sessionStartPreference,
    });
  }, [hasExplicitRoleParam, roleFromQuery, sessionStartPreference, sessionParam, sessionsForTask]);

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

  const sessionByTaskId = useMemo(() => {
    const latestByTask = new Map<string, AgentSessionState>();
    for (const [taskKey, taskSessions] of sessionsByTaskId) {
      const latestSession = taskSessions[0];
      if (latestSession) {
        latestByTask.set(taskKey, latestSession);
      }
    }
    return latestByTask;
  }, [sessionsByTaskId]);

  const clearComposerInput = useCallback((): void => {
    setInput("");
  }, []);

  const signalContextSwitchIntent = useCallback((): void => {
    setContextSwitchVersion((current) => current + 1);
  }, []);

  const {
    tabTaskIds,
    activeTaskTabId,
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
    onContextSwitchIntent: signalContextSwitchIntent,
  });

  const viewTaskId = activeTaskTabId || taskId;
  const viewSelectedTask = useMemo(
    () => (viewTaskId ? (tasksById.get(viewTaskId) ?? null) : null),
    [tasksById, viewTaskId],
  );
  const viewSessionsForTask = useMemo(() => {
    if (!viewTaskId) {
      return [];
    }
    return sessionsByTaskId.get(viewTaskId) ?? [];
  }, [sessionsByTaskId, viewTaskId]);

  const viewSessionParam = useMemo(() => {
    if (!sessionParam) {
      return null;
    }

    const belongsToViewTask = viewSessionsForTask.some(
      (session) => session.sessionId === sessionParam,
    );
    return belongsToViewTask ? sessionParam : null;
  }, [sessionParam, viewSessionsForTask]);

  const isViewTaskDetachedFromQuery = Boolean(viewTaskId && taskId && viewTaskId !== taskId);

  const hasViewRoleSelection = hasExplicitRoleParam && !isViewTaskDetachedFromQuery;

  const normalizedSessionStartPreference = sessionStartPreference ?? null;
  const viewSessionStartPreference = isViewTaskDetachedFromQuery
    ? null
    : normalizedSessionStartPreference;

  const viewActiveSession = useMemo(() => {
    return resolveAgentStudioActiveSession({
      sessionsForTask: viewSessionsForTask,
      sessionParam: viewSessionParam,
      hasExplicitRoleParam: hasViewRoleSelection,
      roleFromQuery,
      sessionStartPreference: viewSessionStartPreference,
    });
  }, [
    hasViewRoleSelection,
    roleFromQuery,
    viewSessionStartPreference,
    viewSessionParam,
    viewSessionsForTask,
  ]);

  const viewRole: AgentRole = hasViewRoleSelection
    ? roleFromQuery
    : (viewActiveSession?.role ??
      viewSessionsForTask[0]?.role ??
      (isViewTaskDetachedFromQuery ? "spec" : roleFromQuery));
  const viewScenarios = SCENARIOS_BY_ROLE[viewRole];
  const viewScenario = hasViewRoleSelection
    ? scenarioFromQuery && viewScenarios.includes(scenarioFromQuery)
      ? scenarioFromQuery
      : firstScenario(viewRole)
    : viewActiveSession?.scenario && viewScenarios.includes(viewActiveSession.scenario)
      ? viewActiveSession.scenario
      : firstScenario(viewRole);

  const hydratedTasksByRepoAndTask = useAgentStudioTaskHydration({
    activeRepo,
    activeTaskId: viewTaskId,
    tabTaskIds,
    loadAgentSessions,
  });

  const taskHydrationKey = activeRepo && viewTaskId ? `${activeRepo}:${viewTaskId}` : "";
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
    scheduleQueryUpdate({
      task: undefined,
      session: undefined,
      agent: undefined,
      scenario: undefined,
      autostart: undefined,
      start: undefined,
    });
  }, [isLoadingTasks, scheduleQueryUpdate, selectedSessionById, taskIdParam, tasks]);

  useEffect(() => {
    if (!selectedSessionById || taskIdParam) {
      return;
    }
    scheduleQueryUpdate({ task: selectedSessionById.taskId });
  }, [scheduleQueryUpdate, selectedSessionById, taskIdParam]);

  useEffect(() => {
    if (!sessionParam) {
      return;
    }
    if (selectedSessionById && taskId && selectedSessionById.taskId !== taskId) {
      scheduleQueryUpdate({ session: undefined });
      return;
    }
    if (!taskId || !isActiveTaskHydrated) {
      return;
    }
    if (selectedSessionById && selectedSessionById.taskId === taskId) {
      return;
    }
    scheduleQueryUpdate({ session: undefined });
  }, [isActiveTaskHydrated, scheduleQueryUpdate, selectedSessionById, sessionParam, taskId]);

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
    scheduleQueryUpdate(updates);
  }, [
    activeSession,
    autostart,
    roleFromQuery,
    scheduleQueryUpdate,
    scenarioFromQuery,
    sessionParam,
    sessionStartPreference,
    taskIdParam,
  ]);

  const { repoSettings } = useAgentStudioRepoSettings({
    activeRepo,
    loadRepoSettings,
  });

  const { specDoc, planDoc, qaDoc } = useAgentStudioDocuments({
    taskId: viewTaskId,
    activeSession: viewActiveSession,
    selectedTask: viewSelectedTask,
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
    activeSession: viewActiveSession,
    role: viewRole,
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
    taskId: viewTaskId,
    role: viewRole,
    scenario: viewScenario,
    autostart,
    sessionStartPreference,
    activeSession: viewActiveSession,
    sessionsForTask: viewSessionsForTask,
    selectedTask: viewSelectedTask,
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
    onContextSwitchIntent: signalContextSwitchIntent,
  });

  const { isSubmittingPermissionByRequestId, permissionReplyErrorByRequestId, onReplyPermission } =
    useAgentSessionPermissionActions({
      activeSessionId: viewActiveSession?.sessionId ?? null,
      pendingPermissions: viewActiveSession?.pendingPermissions ?? [],
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
    activeTabValue: activeTaskTabId || viewTaskId || "__agent_studio_empty__",
    taskId: viewTaskId,
    role: viewRole,
    selectedTask: viewSelectedTask,
    sessionsForTask: viewSessionsForTask,
    contextSessionsLength: viewSessionsForTask.length,
    activeSession: viewActiveSession,
    taskTabs,
    availableTabTasks,
    isTaskHydrating: Boolean(viewTaskId && !isActiveTaskHydrated),
    contextSwitchVersion,
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

  const rightPanel = useAgentStudioRightPanel({
    role: viewRole,
    hasTaskContext: Boolean(viewTaskId),
    hasDocumentPanel: Boolean(agentStudioWorkspaceSidebarModel.activeDocument),
    hasDiffPanel: false,
  });

  return (
    <Tabs
      value={activeTabValue}
      onValueChange={handleSelectTab}
      className="h-full min-h-0 max-h-full gap-0 overflow-hidden bg-white"
    >
      <AgentStudioTaskTabs
        model={agentStudioTaskTabsModel}
        rightPanelToggleModel={rightPanel.rightPanelToggleModel}
      />

      <TabsContent value={activeTabValue} className="m-0 min-h-0 flex-1 bg-white p-0">
        {viewTaskId ? (
          <ResizablePanelGroup direction="horizontal" className="h-full min-h-0 overflow-hidden">
            <ResizablePanel defaultSize={63} minSize={35}>
              <AgentChat
                header={<AgentStudioHeader model={agentStudioHeaderModel} />}
                model={agentChatModel}
              />
            </ResizablePanel>
            {rightPanel.panelKind && rightPanel.isPanelOpen ? (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={37} minSize={30}>
                  <AgentStudioRightPanel
                    model={{
                      kind: rightPanel.panelKind,
                      documentsModel: agentStudioWorkspaceSidebarModel,
                    }}
                  />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        ) : (
          <div className="flex h-full min-h-0 items-center justify-center border border-dashed border-slate-300 bg-white text-sm text-slate-500">
            Open a task tab to start a workspace.
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
