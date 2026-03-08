import { AlertTriangle, RefreshCcw } from "lucide-react";
import {
  type ReactElement,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AgentChat,
  AgentStudioHeader,
  AgentStudioRightPanel,
  AgentStudioTaskTabs,
  SessionStartModal,
} from "@/components/features/agents";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { DiffWorkerProvider } from "@/contexts/DiffWorkerProvider";
import { errorMessage } from "@/lib/errors";
import { UPSTREAM_TARGET_BRANCH } from "@/lib/target-branch";
import { useAgentState, useChecksState, useTasksState, useWorkspaceState } from "@/state";
import {
  useDelegationEventsContext,
  useRuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import { loadEffectivePromptOverrides } from "../../state/operations/prompt-overrides";
import {
  buildSessionStartModalDescription,
  buildSessionStartModalTitle,
  toSessionStartPostAction,
  useSessionStartModalCoordinator,
} from "../shared/use-session-start-modal-coordinator";
import type { AgentStudioQueryUpdate } from "./agent-studio-navigation";
import { buildRebaseConflictResolutionPrompt, SCENARIO_LABELS } from "./agents-page-constants";
import {
  buildAgentStudioGitPanelBranchIdentityKey,
  resolveAgentStudioGitPanelBranch,
} from "./agents-page-git-panel";
import {
  resolveAgentStudioBuilderSessionForTask,
  resolveAgentStudioBuilderSessionsForTask,
} from "./agents-page-selection";
import { useAgentStudioBuildWorktreeRefresh } from "./use-agent-studio-build-worktree-refresh";
import { useAgentStudioDiffData } from "./use-agent-studio-diff-data";
import {
  type AgentStudioRebaseConflict,
  useAgentStudioGitActions,
} from "./use-agent-studio-git-actions";
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
import { buildAgentStudioRightPanelModel } from "./use-agent-studio-right-panel";
import { useAgentStudioSelectionController } from "./use-agent-studio-selection-controller";
import type {
  NewSessionStartDecision,
  NewSessionStartRequest,
} from "./use-agent-studio-session-actions";
import { useAgentStudioSessionStartRequest } from "./use-agent-studio-session-start-request";

type AgentStudioSessionStartModalProps = {
  request: NewSessionStartRequest;
  activeRepo: string | null;
  repoSettings: RepoSettingsInput | null;
  onCancel: () => void;
  onConfirm: (decision: NonNullable<NewSessionStartDecision>) => void;
};

type RebaseConflictResolutionDecision =
  | {
      mode: "existing";
      sessionId: string;
    }
  | {
      mode: "new";
    }
  | null;

type PendingRebaseConflictResolutionRequest = {
  conflict: AgentStudioRebaseConflict;
  builderSessions: AgentSessionState[];
  currentWorktreePath: string;
  currentViewSessionId: string | null;
  defaultMode: "existing" | "new";
  defaultSessionId: string | null;
};

type RebaseConflictResolutionModalProps = {
  request: PendingRebaseConflictResolutionRequest;
  onCancel: () => void;
  onConfirm: (decision: NonNullable<RebaseConflictResolutionDecision>) => void;
};

const formatConflictResolutionSessionMeta = (session: AgentSessionState): string => {
  const startedAt = new Date(session.startedAt);
  const startedAtLabel = Number.isNaN(startedAt.getTime())
    ? session.startedAt
    : startedAt.toLocaleString();
  return `${startedAtLabel} · ${session.status} · ${session.sessionId.slice(0, 8)}`;
};

function RebaseConflictResolutionModal({
  request,
  onCancel,
  onConfirm,
}: RebaseConflictResolutionModalProps): ReactElement {
  const [mode, setMode] = useState<"existing" | "new">(request.defaultMode);
  const [selectedSessionId, setSelectedSessionId] = useState(request.defaultSessionId ?? "");
  const hasExistingSessions = request.builderSessions.length > 0;
  const confirmDisabled = mode === "existing" && selectedSessionId.trim().length === 0;

  useEffect(() => {
    setMode(request.defaultMode);
    setSelectedSessionId(request.defaultSessionId ?? "");
  }, [request.defaultMode, request.defaultSessionId]);

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
      }}
    >
      <DialogContent className="max-w-2xl overflow-hidden p-0">
        <div className="space-y-6 px-6 py-6 sm:px-7 sm:py-7">
          <DialogHeader className="space-y-3 pr-10">
            <DialogTitle>Resolve rebase conflict with Builder</DialogTitle>
            <DialogDescription className="max-w-[42rem] text-[15px] leading-7">
              Choose an existing Builder session for this task, or start a new conflict-resolution
              Builder session in the current worktree.
            </DialogDescription>
          </DialogHeader>

          {hasExistingSessions ? (
            <div className="space-y-3">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                Existing session
              </p>
              <div className="space-y-2">
                {request.builderSessions.map((session) => {
                  const isSelected = mode === "existing" && selectedSessionId === session.sessionId;
                  const isCurrentViewSession = session.sessionId === request.currentViewSessionId;
                  return (
                    <button
                      key={session.sessionId}
                      type="button"
                      className={`flex w-full cursor-pointer items-start justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card hover:bg-muted/40"
                      }`}
                      onClick={() => {
                        setMode("existing");
                        setSelectedSessionId(session.sessionId);
                      }}
                      data-testid={`agent-studio-rebase-conflict-session-option-${session.sessionId}`}
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {SCENARIO_LABELS[session.scenario] ?? session.scenario}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatConflictResolutionSessionMeta(session)}
                        </p>
                      </div>
                      {isCurrentViewSession ? (
                        <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          Current view
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="space-y-3">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              New session
            </p>
            <button
              type="button"
              className={`flex w-full cursor-pointer items-start justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                mode === "new"
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:bg-muted/40"
              }`}
              onClick={() => setMode("new")}
              data-testid="agent-studio-rebase-conflict-new-session-option"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Start a new Builder session in the current worktree
                </p>
                <p className="text-xs text-muted-foreground">
                  The new session will attach to{" "}
                  <code className="font-mono">{request.currentWorktreePath}</code>.
                </p>
              </div>
            </button>
          </div>
        </div>

        <DialogFooter className="mt-0 flex flex-row items-center justify-between border-t border-border px-6 py-5 sm:px-7">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={confirmDisabled}
            onClick={() => {
              if (mode === "existing" && selectedSessionId.trim().length > 0) {
                onConfirm({ mode: "existing", sessionId: selectedSessionId });
                return;
              }
              onConfirm({ mode: "new" });
            }}
            data-testid="agent-studio-rebase-conflict-confirm-button"
          >
            {mode === "existing" ? "Use selected session" : "Start new session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
    selectedRuntimeKind,
    runtimeOptions,
    supportsProfiles,
    supportsVariants,
    isCatalogLoading,
    agentOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    openStartModal,
    closeStartModal,
    handleSelectRuntime,
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
      request.selectedModel?.providerId ?? "",
      request.selectedModel?.modelId ?? "",
      request.selectedModel?.variant ?? "",
      request.selectedModel?.profileId ?? "",
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
        title: intent?.title ?? buildSessionStartModalTitle(request.role),
        description:
          intent?.description ??
          buildSessionStartModalDescription({
            scenario: request.scenario,
            startMode: request.startMode,
          }),
        confirmLabel: "Start session",
        selectedModelSelection: selection,
        selectedRuntimeKind,
        runtimeOptions,
        supportsProfiles,
        supportsVariants,
        isSelectionCatalogLoading: isCatalogLoading,
        agentOptions,
        modelOptions,
        modelGroups,
        variantOptions,
        onSelectRuntime: handleSelectRuntime,
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
  const { activeRepo, activeBranch, loadRepoSettings } = useWorkspaceState();
  const { runtimeDefinitions, isLoadingRuntimeDefinitions, runtimeDefinitionsError } =
    useRuntimeDefinitionsContext();
  const { runtimeHealthByRuntime, isLoadingChecks, refreshChecks } = useChecksState();
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
  const [runCompletionRecoverySignal, setRunCompletionRecoverySignal] = useState(0);
  const latestRunCompletionSignalVersionRef = useRef<number | null>(null);
  const [pendingRebaseConflictResolutionRequest, setPendingRebaseConflictResolutionRequest] =
    useState<PendingRebaseConflictResolutionRequest | null>(null);
  const pendingRebaseConflictResolutionResolverRef = useRef<
    ((decision: RebaseConflictResolutionDecision) => void) | null
  >(null);
  const { runCompletionSignal } = useDelegationEventsContext();
  const { pendingSessionStartRequest, requestNewSessionStart, resolvePendingSessionStart } =
    useAgentStudioSessionStartRequest();

  const {
    taskIdParam,
    sessionParam,
    hasExplicitRoleParam,
    roleFromQuery,
    navigationPersistenceError,
    retryNavigationPersistence,
    updateQuery,
  } = useAgentStudioQuerySync({
    activeRepo,
    searchParams,
    setSearchParams,
  });

  const scheduleQueryUpdate = useCallback(
    (updates: AgentStudioQueryUpdate): void => {
      startTransition(() => {
        updateQuery(updates);
      });
    },
    [updateQuery],
  );
  const requestRebaseConflictResolutionChoice = useCallback(
    (
      request: PendingRebaseConflictResolutionRequest,
    ): Promise<RebaseConflictResolutionDecision> => {
      pendingRebaseConflictResolutionResolverRef.current?.(null);
      return new Promise((resolve) => {
        pendingRebaseConflictResolutionResolverRef.current = resolve;
        setPendingRebaseConflictResolutionRequest(request);
      });
    },
    [],
  );
  const resolvePendingRebaseConflictResolution = useCallback(
    (decision: RebaseConflictResolutionDecision): void => {
      const resolver = pendingRebaseConflictResolutionResolverRef.current;
      pendingRebaseConflictResolutionResolverRef.current = null;
      setPendingRebaseConflictResolutionRequest(null);
      resolver?.(decision);
    },
    [],
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
    updateQuery,
    loadAgentSessions,
    clearComposerInput,
    onContextSwitchIntent: signalContextSwitchIntent,
  });

  useEffect(() => {
    const activeBuildRunId =
      selection.viewActiveSession?.role === "build" ? selection.viewActiveSession.runId : null;

    if (!runCompletionSignal || !activeBuildRunId) {
      return;
    }

    if (runCompletionSignal.runId !== activeBuildRunId) {
      return;
    }

    if (runCompletionSignal.version === latestRunCompletionSignalVersionRef.current) {
      return;
    }

    latestRunCompletionSignalVersionRef.current = runCompletionSignal.version;
    setRunCompletionRecoverySignal((current) => current + 1);
  }, [runCompletionSignal, selection.viewActiveSession?.runId, selection.viewActiveSession?.role]);

  useAgentStudioQuerySessionSync({
    isLoadingTasks,
    tasks,
    taskIdParam,
    sessionParam,
    selectedSessionById: selection.selectedSessionById,
    taskId: selection.taskId,
    activeSession: selection.activeSession,
    roleFromQuery,
    isActiveTaskHydrated: selection.isActiveTaskHydrated,
    scheduleQueryUpdate,
  });

  const healthyRuntimeDefinition = useMemo(
    () =>
      runtimeDefinitions.find((definition) => {
        const runtimeHealth = runtimeHealthByRuntime[definition.kind];
        return Boolean(
          runtimeHealth?.runtimeOk &&
            (!definition.capabilities.supportsMcpStatus || runtimeHealth.mcpOk),
        );
      }) ?? null,
    [runtimeDefinitions, runtimeHealthByRuntime],
  );
  const blockedRuntimeDefinition = useMemo(
    () =>
      runtimeDefinitions.find((definition) => {
        const runtimeHealth = runtimeHealthByRuntime[definition.kind];
        return Boolean(
          runtimeHealth &&
            (!runtimeHealth.runtimeOk ||
              (definition.capabilities.supportsMcpStatus && !runtimeHealth.mcpOk)),
        );
      }) ?? null,
    [runtimeDefinitions, runtimeHealthByRuntime],
  );
  const blockedRuntimeHealth = blockedRuntimeDefinition
    ? (runtimeHealthByRuntime[blockedRuntimeDefinition.kind] ?? null)
    : null;

  const agentStudioReady = Boolean(activeRepo && healthyRuntimeDefinition);
  const agentStudioBlockedReason = !activeRepo
    ? "Select a repository to use Agent Studio."
    : runtimeDefinitionsError
      ? runtimeDefinitionsError
      : isLoadingRuntimeDefinitions
        ? "Loading runtime definitions..."
        : isLoadingChecks
          ? "Checking runtime and OpenDucktor MCP health..."
          : (blockedRuntimeHealth?.runtimeError ??
            blockedRuntimeHealth?.mcpError ??
            (runtimeDefinitions.length === 0
              ? "No agent runtimes are available."
              : "No configured runtime is ready for Agent Studio."));

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

  const gitPanelContextMode: "repository" | "worktree" =
    selection.viewActiveSession?.role === "build" ? "worktree" : "repository";
  const repositoryBranchIdentityKey =
    gitPanelContextMode === "repository"
      ? buildAgentStudioGitPanelBranchIdentityKey(activeBranch)
      : null;
  const diffComparisonTarget =
    gitPanelContextMode === "repository"
      ? UPSTREAM_TARGET_BRANCH
      : (orchestration.repoSettings?.defaultTargetBranch ?? "origin/main");

  const diffData = useAgentStudioDiffData({
    repoPath: activeRepo,
    sessionWorkingDirectory: selection.viewActiveSession?.workingDirectory ?? null,
    sessionRunId: selection.viewActiveSession?.runId ?? null,
    runCompletionRecoverySignal,
    defaultTargetBranch: diffComparisonTarget,
    branchIdentityKey: repositoryBranchIdentityKey,
    enablePolling:
      selection.viewRole === "build" &&
      Boolean(selection.viewActiveSession) &&
      orchestration.rightPanel.isPanelOpen,
  });
  const resolvedGitPanelBranch = resolveAgentStudioGitPanelBranch({
    contextMode: gitPanelContextMode,
    workspaceActiveBranch: activeBranch,
    diffBranch: diffData.branch,
  });
  useAgentStudioBuildWorktreeRefresh({
    viewRole: selection.viewRole,
    activeSession: selection.viewActiveSession,
    refreshWorktree: diffData.refresh,
  });
  const isActiveBuilderWorking =
    selection.viewActiveSession?.role === "build" &&
    (selection.viewActiveSession.status === "running" ||
      selection.viewActiveSession.status === "starting");
  const handleResolveRebaseConflict = useCallback(
    async (conflict: AgentStudioRebaseConflict): Promise<boolean> => {
      if (!activeRepo) {
        throw new Error("Cannot resolve rebase conflict because no repository is selected.");
      }
      if (!selection.viewTaskId) {
        throw new Error("Cannot resolve rebase conflict because no task is selected.");
      }

      const builderSessions = resolveAgentStudioBuilderSessionsForTask({
        taskId: selection.viewTaskId,
        viewActiveSession: selection.viewActiveSession,
        activeSession: selection.activeSession,
        selectedSessionById: selection.selectedSessionById,
        viewSessionsForTask: selection.viewSessionsForTask,
        sessionsForTask: selection.sessionsForTask,
      });
      const defaultBuilderSession = resolveAgentStudioBuilderSessionForTask({
        taskId: selection.viewTaskId,
        viewActiveSession: selection.viewActiveSession,
        activeSession: selection.activeSession,
        selectedSessionById: selection.selectedSessionById,
        viewSessionsForTask: selection.viewSessionsForTask,
        sessionsForTask: selection.sessionsForTask,
      });
      const currentWorktreePath = (conflict.workingDir ?? activeRepo)?.trim() ?? "";
      if (!currentWorktreePath) {
        throw new Error(
          "Cannot resolve rebase conflict because the current worktree path is unavailable.",
        );
      }

      const decision = await requestRebaseConflictResolutionChoice({
        conflict,
        builderSessions,
        currentWorktreePath,
        currentViewSessionId:
          selection.viewActiveSession?.role === "build"
            ? selection.viewActiveSession.sessionId
            : null,
        defaultMode: defaultBuilderSession ? "existing" : "new",
        defaultSessionId: defaultBuilderSession?.sessionId ?? null,
      });
      if (!decision) {
        return false;
      }

      const promptOverrides = await loadEffectivePromptOverrides(activeRepo);
      const message = buildRebaseConflictResolutionPrompt(selection.viewTaskId, {
        overrides: promptOverrides,
        ...(selection.viewSelectedTask
          ? {
              task: {
                title: selection.viewSelectedTask.title,
                issueType: selection.viewSelectedTask.issueType,
                status: selection.viewSelectedTask.status,
                qaRequired: selection.viewSelectedTask.aiReviewEnabled,
                description: selection.viewSelectedTask.description,
                acceptanceCriteria: selection.viewSelectedTask.acceptanceCriteria,
              },
            }
          : {}),
        git: {
          ...(conflict.currentBranch ? { currentBranch: conflict.currentBranch } : {}),
          targetBranch: conflict.targetBranch,
          conflictedFiles: conflict.conflictedFiles,
          rebaseOutput: conflict.output,
        },
      });

      if (decision.mode === "existing") {
        const builderSession = builderSessions.find(
          (session) => session.sessionId === decision.sessionId,
        );
        if (!builderSession) {
          throw new Error("Selected Builder session is no longer available for this task.");
        }

        if (
          selection.viewActiveSession?.sessionId !== builderSession.sessionId ||
          selection.viewActiveSession?.role !== builderSession.role
        ) {
          signalContextSwitchIntent();
          scheduleQueryUpdate({
            task: builderSession.taskId,
            session: builderSession.sessionId,
            agent: builderSession.role,
          });
        }

        void sendAgentMessage(builderSession.sessionId, message).catch((error) => {
          toast.error("Failed to send Builder conflict resolution request", {
            description: errorMessage(error),
          });
        });
        return true;
      }

      const sessionId = await startAgentSession({
        taskId: selection.viewTaskId,
        role: "build",
        scenario: "build_rebase_conflict_resolution",
        selectedModel: defaultBuilderSession?.selectedModel ?? null,
        sendKickoff: false,
        startMode: "fresh",
        requireModelReady: true,
        workingDirectoryOverride: currentWorktreePath,
      });

      signalContextSwitchIntent();
      scheduleQueryUpdate({
        task: selection.viewTaskId,
        session: sessionId,
        agent: "build",
      });
      void sendAgentMessage(sessionId, message).catch((error) => {
        toast.error("Failed to send Builder conflict resolution request", {
          description: errorMessage(error),
        });
      });
      return true;
    },
    [
      activeRepo,
      requestRebaseConflictResolutionChoice,
      scheduleQueryUpdate,
      selection.viewActiveSession,
      selection.activeSession,
      selection.selectedSessionById,
      selection.viewSelectedTask,
      selection.viewSessionsForTask,
      selection.sessionsForTask,
      selection.viewTaskId,
      sendAgentMessage,
      signalContextSwitchIntent,
      startAgentSession,
    ],
  );
  const gitActions = useAgentStudioGitActions({
    repoPath: activeRepo,
    workingDir: diffData.worktreePath,
    branch: resolvedGitPanelBranch,
    targetBranch: diffData.targetBranch,
    upstreamAheadBehind: diffData.upstreamAheadBehind ?? null,
    detectedConflictedFiles: diffData.fileStatuses
      .filter((status) => status.status === "unmerged")
      .map((status) => status.path),
    worktreeStatusSnapshotKey: diffData.statusSnapshotKey ?? null,
    refreshDiffData: diffData.refresh,
    isBuilderSessionWorking: isActiveBuilderWorking,
    onResolveRebaseConflict: handleResolveRebaseConflict,
  });
  const diffModel = useMemo(
    () => ({
      ...diffData,
      contextMode: gitPanelContextMode,
      branch: resolvedGitPanelBranch,
      ...gitActions,
    }),
    [diffData, gitActions, gitPanelContextMode, resolvedGitPanelBranch],
  );
  const rightPanelModel = useMemo(
    () =>
      buildAgentStudioRightPanelModel({
        panelKind: orchestration.rightPanel.panelKind,
        documentsModel: orchestration.agentStudioWorkspaceSidebarModel,
        diffModel,
      }),
    [diffModel, orchestration.agentStudioWorkspaceSidebarModel, orchestration.rightPanel.panelKind],
  );
  const content = navigationPersistenceError ? (
    <div className="flex h-full min-h-0 items-center justify-center bg-card p-4">
      <div className="flex w-full max-w-2xl flex-col gap-4 rounded-xl border border-destructive-border bg-destructive-surface px-4 py-4 text-sm text-destructive-muted">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 space-y-2">
            <p className="font-medium text-destructive">
              Agent Studio couldn&apos;t restore saved navigation context.
            </p>
            <p>{`Repository: ${activeRepo}`}</p>
            <p className="break-words font-mono text-xs">{navigationPersistenceError.message}</p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-destructive-border bg-card text-destructive-muted hover:bg-destructive-surface"
            onClick={retryNavigationPersistence}
          >
            <RefreshCcw className="size-3.5" />
            Retry restore
          </Button>
        </div>
      </div>
    </div>
  ) : (
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
                  {rightPanelModel ? <AgentStudioRightPanel model={rightPanelModel} /> : null}
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
      {pendingRebaseConflictResolutionRequest ? (
        <RebaseConflictResolutionModal
          request={pendingRebaseConflictResolutionRequest}
          onCancel={() => resolvePendingRebaseConflictResolution(null)}
          onConfirm={resolvePendingRebaseConflictResolution}
        />
      ) : null}
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

  return <DiffWorkerProvider>{content}</DiffWorkerProvider>;
}
