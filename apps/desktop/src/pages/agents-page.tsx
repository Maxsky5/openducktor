import { AgentChat } from "@/components/features/agents/agent-chat";
import { AgentStudioHeader } from "@/components/features/agents/agent-studio-header";
import { AgentStudioTaskTabs } from "@/components/features/agents/agent-studio-task-tabs";
import { AgentStudioWorkspaceSidebar } from "@/components/features/agents/agent-studio-workspace-sidebar";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useAgentState, useChecksState, useTasksState, useWorkspaceState } from "@/state";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ROLE_OPTIONS,
  SCENARIOS_BY_ROLE,
  firstScenario,
  isRole,
  isScenario,
} from "./agents-page-constants";
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

  const taskIdParam = searchParams.get("task") ?? "";
  const sessionParam = searchParams.get("session");
  const roleParam = searchParams.get("agent");
  const hasExplicitRoleParam = isRole(roleParam);
  const roleFromQuery: AgentRole = hasExplicitRoleParam ? roleParam : "spec";
  const scenarioParam = searchParams.get("scenario");
  const scenarioFromQuery: AgentScenario | undefined = isScenario(scenarioParam)
    ? scenarioParam
    : undefined;
  const autostart = searchParams.get("autostart") === "1";

  const selectedSessionById = useMemo(
    () => sessions.find((entry) => entry.sessionId === sessionParam) ?? null,
    [sessionParam, sessions],
  );

  const taskId = selectedSessionById?.taskId ?? taskIdParam;
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
    if (selectedSessionById?.taskId === taskId) {
      return selectedSessionById;
    }
    if (sessionParam) {
      return null;
    }
    if (hasExplicitRoleParam) {
      return sessionsForTask.find((entry) => entry.role === roleFromQuery) ?? null;
    }
    return sessionsForTask[0] ?? null;
  }, [
    hasExplicitRoleParam,
    roleFromQuery,
    selectedSessionById,
    sessionParam,
    sessionsForTask,
    taskId,
  ]);

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

  const { updateQuery } = useAgentStudioQuerySync({
    activeRepo,
    searchParams,
    setSearchParams,
    taskIdParam,
    taskId,
    role,
    scenario,
    selectedSessionById,
    activeSession,
    isLoadingTasks,
    tasks,
  });

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
    if (!sessionParam || selectedSessionById) {
      return;
    }
    if (!taskId || !isActiveTaskHydrated) {
      return;
    }
    updateQuery({ session: undefined });
  }, [isActiveTaskHydrated, selectedSessionById, sessionParam, taskId, updateQuery]);

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
      className="h-[calc(100vh-2rem)] min-h-0 max-h-[calc(100vh-2rem)] gap-0 overflow-hidden"
    >
      <AgentStudioTaskTabs model={agentStudioTaskTabsModel} />

      <TabsContent value={activeTabValue} className="m-0 min-h-0 flex-1 rounded-b-xl bg-white p-3">
        {taskId ? (
          <div className="grid h-full min-h-0 gap-4 overflow-hidden xl:grid-cols-[minmax(0,2fr)_minmax(420px,1fr)]">
            <AgentChat
              header={<AgentStudioHeader model={agentStudioHeaderModel} />}
              model={agentChatModel}
            />

            <AgentStudioWorkspaceSidebar model={agentStudioWorkspaceSidebarModel} />
          </div>
        ) : (
          <div className="flex h-full min-h-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-500">
            Open a task tab to start a workspace.
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
