import {
  type ReactElement,
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  AgentChat,
  AgentStudioHeader,
  AgentStudioRightPanel,
  AgentStudioTaskTabs,
  SessionStartModal,
} from "@/components/features/agents";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useAgentState, useChecksState, useTasksState, useWorkspaceState } from "@/state";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  type AgentStudioOrchestrationActionsContext,
  type AgentStudioOrchestrationComposerContext,
  type AgentStudioOrchestrationReadinessContext,
  type AgentStudioOrchestrationSelectionContext,
  type AgentStudioOrchestrationWorkspaceContext,
  useAgentStudioOrchestrationController,
} from "./use-agent-studio-orchestration-controller";
import { useAgentStudioQuerySessionSync } from "./use-agent-studio-query-session-sync";
import { useAgentStudioQuerySync } from "./use-agent-studio-query-sync";
import { useAgentStudioSelectionController } from "./use-agent-studio-selection-controller";
import type {
  NewSessionStartDecision,
  NewSessionStartRequest,
} from "./use-agent-studio-session-actions";
import { useAgentStudioSessionStartRequest } from "./use-agent-studio-session-start-request";
import {
  toSessionStartPostAction,
  useSessionStartModalCoordinator,
} from "./use-session-start-modal-coordinator";

type AgentStudioSessionStartModalProps = {
  request: NewSessionStartRequest;
  activeRepo: string | null;
  repoSettings: RepoSettingsInput | null;
  onCancel: () => void;
  onConfirm: (decision: NonNullable<NewSessionStartDecision>) => void;
};

function AgentStudioSessionStartModal({
  request,
  activeRepo,
  repoSettings,
  onCancel,
  onConfirm,
}: AgentStudioSessionStartModalProps): ReactElement {
  const initializedRequestKeyRef = useRef<string | null>(null);
  const {
    intent,
    isOpen,
    selection,
    isCatalogLoading,
    agentOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    openStartModal,
    closeStartModal,
    handleSelectAgent,
    handleSelectModel,
    handleSelectVariant,
  } = useSessionStartModalCoordinator({
    activeRepo,
    repoSettings,
  });

  useEffect(() => {
    const requestKey = [
      request.taskId,
      request.role,
      request.scenario,
      request.startMode,
      request.reason,
    ].join(":");
    if (initializedRequestKeyRef.current === requestKey) {
      return;
    }
    initializedRequestKeyRef.current = requestKey;

    openStartModal({
      source: "agent_studio",
      taskId: request.taskId,
      role: request.role,
      scenario: request.scenario,
      startMode: request.startMode,
      selectedModel: request.selectedModel,
      postStartAction: toSessionStartPostAction(request.reason),
    });
  }, [openStartModal, request]);

  return (
    <SessionStartModal
      model={{
        open: isOpen,
        title: intent?.title ?? "Start session",
        description:
          intent?.description ?? "Choose agent, model, and variant before starting this session.",
        confirmLabel: "Start session",
        selectedModelSelection: selection,
        isSelectionCatalogLoading: isCatalogLoading,
        agentOptions,
        modelOptions,
        modelGroups,
        variantOptions,
        onSelectAgent: handleSelectAgent,
        onSelectModel: handleSelectModel,
        onSelectVariant: handleSelectVariant,
        allowRunInBackground: false,
        isStarting: false,
        onOpenChange: (nextOpen) => {
          if (!nextOpen) {
            closeStartModal();
            onCancel();
          }
        },
        onConfirm: (_runInBackground) => {
          onConfirm({ selectedModel: selection ?? null });
        },
      }}
    />
  );
}

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
  const { pendingSessionStartRequest, requestNewSessionStart, resolvePendingSessionStart } =
    useAgentStudioSessionStartRequest();

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

  const clearComposerInput = useCallback((): void => {
    setInput("");
  }, []);

  const signalContextSwitchIntent = useCallback((): void => {
    setContextSwitchVersion((current) => current + 1);
  }, []);

  const selection = useAgentStudioSelectionController({
    activeRepo,
    tasks,
    isLoadingTasks,
    sessions,
    taskIdParam,
    sessionParam,
    hasExplicitRoleParam,
    roleFromQuery,
    scenarioFromQuery,
    sessionStartPreference,
    updateQuery,
    loadAgentSessions,
    clearComposerInput,
    onContextSwitchIntent: signalContextSwitchIntent,
  });

  useAgentStudioQuerySessionSync({
    isLoadingTasks,
    tasks,
    taskIdParam,
    sessionParam,
    selectedSessionById: selection.selectedSessionById,
    taskId: selection.taskId,
    activeSession: selection.activeSession,
    autostart,
    roleFromQuery,
    scenarioFromQuery,
    sessionStartPreference,
    isActiveTaskHydrated: selection.isActiveTaskHydrated,
    scheduleQueryUpdate,
  });

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

  const orchestrationWorkspace = {
    activeRepo,
    loadRepoSettings,
  } satisfies AgentStudioOrchestrationWorkspaceContext;

  const orchestrationSelection = {
    viewTaskId: selection.viewTaskId,
    viewRole: selection.viewRole,
    viewScenario: selection.viewScenario,
    viewSelectedTask: selection.viewSelectedTask,
    viewSessionsForTask: selection.viewSessionsForTask,
    viewActiveSession: selection.viewActiveSession,
    activeTaskTabId: selection.activeTaskTabId,
    taskTabs: selection.taskTabs,
    availableTabTasks: selection.availableTabTasks,
    contextSwitchVersion,
    isLoadingTasks,
    isActiveTaskHydrated: selection.isActiveTaskHydrated,
    onCreateTab: selection.handleCreateTab,
    onCloseTab: selection.handleCloseTab,
  } satisfies AgentStudioOrchestrationSelectionContext;

  const orchestrationReadiness = {
    agentStudioReady,
    agentStudioBlockedReason,
    isLoadingChecks,
    refreshChecks,
  } satisfies AgentStudioOrchestrationReadinessContext;

  const orchestrationComposer = {
    input,
    setInput,
  } satisfies AgentStudioOrchestrationComposerContext;

  const orchestrationActions = {
    updateQuery,
    onContextSwitchIntent: signalContextSwitchIntent,
    startAgentSession,
    sendAgentMessage,
    stopAgentSession,
    updateAgentSessionModel,
    replyAgentPermission,
    answerAgentQuestion,
    requestNewSessionStart,
  } satisfies AgentStudioOrchestrationActionsContext;

  const orchestration = useAgentStudioOrchestrationController({
    workspace: orchestrationWorkspace,
    selection: orchestrationSelection,
    readiness: orchestrationReadiness,
    composer: orchestrationComposer,
    actions: orchestrationActions,
  });

  return (
    <Tabs
      value={orchestration.activeTabValue}
      onValueChange={selection.handleSelectTab}
      className="h-full min-h-0 max-h-full gap-0 overflow-hidden bg-card"
    >
      <AgentStudioTaskTabs
        model={orchestration.agentStudioTaskTabsModel}
        rightPanelToggleModel={orchestration.rightPanel.rightPanelToggleModel}
      />

      <TabsContent value={orchestration.activeTabValue} className="m-0 min-h-0 flex-1 bg-card p-0">
        {selection.viewTaskId ? (
          <ResizablePanelGroup direction="horizontal" className="h-full min-h-0 overflow-hidden">
            <ResizablePanel defaultSize={63} minSize={35}>
              <AgentChat
                header={<AgentStudioHeader model={orchestration.agentStudioHeaderModel} />}
                model={orchestration.agentChatModel}
              />
            </ResizablePanel>
            {orchestration.rightPanel.panelKind && orchestration.rightPanel.isPanelOpen ? (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={37} minSize={30}>
                  <AgentStudioRightPanel
                    model={{
                      kind: orchestration.rightPanel.panelKind,
                      documentsModel: orchestration.agentStudioWorkspaceSidebarModel,
                    }}
                  />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        ) : (
          <div className="flex h-full min-h-0 items-center justify-center border border-dashed border-input bg-card text-sm text-muted-foreground">
            Open a task tab to start a workspace.
          </div>
        )}
      </TabsContent>
      {pendingSessionStartRequest ? (
        <AgentStudioSessionStartModal
          request={pendingSessionStartRequest}
          activeRepo={activeRepo}
          repoSettings={orchestration.repoSettings}
          onCancel={() => resolvePendingSessionStart(null)}
          onConfirm={resolvePendingSessionStart}
        />
      ) : null}
    </Tabs>
  );
}
