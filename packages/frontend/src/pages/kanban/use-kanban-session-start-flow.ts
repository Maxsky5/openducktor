import type { GitBranch, GitTargetBranch, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useCallback, useMemo, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { toast } from "sonner";
import type { SessionStartModalModel } from "@/components/features/agents";
import {
  isKanbanActiveTaskSession,
  toKanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import type { SessionTargetOptions } from "@/components/features/kanban/session-target-resolution";
import { resolvePreferredActiveSession } from "@/components/features/kanban/session-target-resolution";
import { submitHumanReviewFeedback } from "@/features/human-review-feedback/human-review-feedback-flow";
import {
  buildHumanReviewFeedbackModalModel,
  createHumanReviewFeedbackState,
} from "@/features/human-review-feedback/human-review-feedback-state";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import { useHumanReviewFeedbackController } from "@/features/human-review-feedback/use-human-review-feedback-controller";
import {
  buildReusableSessionOptions,
  buildSessionStartModalRequest,
  firstLaunchAction,
  type RunSessionStartWorkflow,
  resolveBuildContinuationLaunchAction,
  useSessionStartModalRunner,
} from "@/features/session-start";
import { matchesAgentSessionIdentity, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import type { KanbanSessionStartIntent } from "./kanban-page-model-types";
import { startKanbanSessionFlow } from "./kanban-session-start-actions";

const ROLE_LABELS = AGENT_ROLE_LABELS as Record<AgentRole, string>;

type UseKanbanSessionStartFlowArgs = {
  activeWorkspaceId: string | null;
  branches?: GitBranch[];
  repoSettings: RepoSettingsInput | null;
  openAgentStudioTabOnBackgroundSessionStart: boolean | null;
  tasks: TaskCard[];
  sessions: AgentSessionSummary[];
  navigate: NavigateFunction;
  workspaceRepoPath: string | null;
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  setTaskTargetBranch?: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  runSessionStartWorkflow: RunSessionStartWorkflow;
};

type UseKanbanSessionStartFlowResult = {
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  sessionStartModal: SessionStartModalModel | null;
  startSessionIntent: (
    intent: KanbanSessionStartIntent,
  ) => Promise<AgentSessionIdentity | undefined>;
  onPullRequestGenerate: (taskId: string) => Promise<string | undefined>;
  onDelegate: (taskId: string) => void;
  onOpenSession: (taskId: string, role: AgentRole, options?: SessionTargetOptions) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart: (taskId: string) => void;
  onQaOpen: (taskId: string) => void;
  onBuild: (taskId: string) => void;
  onHumanRequestChanges: (taskId: string) => void;
};

const findLatestSessionByRoleForTask = (
  sessions: AgentSessionSummary[],
  taskId: string,
  role: AgentRole,
): AgentSessionSummary | null => {
  return findSessionsByRoleForTask(sessions, taskId, role)[0] ?? null;
};

const findPreferredSessionByRoleForTask = (
  sessions: AgentSessionSummary[],
  taskId: string,
  role: AgentRole,
): AgentSessionSummary | null => {
  const matchingSessions = findSessionsByRoleForTask(sessions, taskId, role).filter(
    isKanbanActiveTaskSession,
  );
  if (matchingSessions.length === 0) {
    return null;
  }

  const preferredSession = resolvePreferredActiveSession(
    matchingSessions.map(toKanbanTaskSession),
    role,
  );

  if (!preferredSession) {
    return null;
  }

  return (
    matchingSessions.find((session) => matchesAgentSessionIdentity(session, preferredSession)) ??
    null
  );
};

const findSessionsByRoleForTask = (
  sessions: AgentSessionSummary[],
  taskId: string,
  role: AgentRole,
): AgentSessionSummary[] => {
  return sessions
    .filter((session) => session.taskId === taskId && session.role === role)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
};

const resolveKanbanPlanningStartPreference = (
  tasks: TaskCard[],
  taskId: string,
  action: "set_spec" | "set_plan",
): "fresh" | "continue" => {
  if (action === "set_plan") {
    return "fresh";
  }
  const task = tasks.find((entry) => entry.id === taskId);
  return task?.status === "spec_ready" ? "continue" : "fresh";
};

export function useKanbanSessionStartFlow({
  activeWorkspaceId,
  branches = [],
  repoSettings,
  openAgentStudioTabOnBackgroundSessionStart,
  tasks,
  sessions,
  navigate,
  workspaceRepoPath,
  humanRequestChangesTask,
  setTaskTargetBranch,
  runSessionStartWorkflow,
}: UseKanbanSessionStartFlowArgs): UseKanbanSessionStartFlowResult {
  const [isSubmittingHumanReviewFeedback, setIsSubmittingHumanReviewFeedback] = useState(false);

  const { sessionStartModal, runSessionStartRequest } = useSessionStartModalRunner({
    branches,
    repoSettings,
    workspaceRepoPath,
  });

  const {
    clearHumanReviewFeedback,
    humanReviewFeedbackState,
    openHumanReviewFeedback,
    setHumanReviewFeedbackState,
  } = useHumanReviewFeedbackController({
    createState: (taskId) => createHumanReviewFeedbackState(tasks, taskId),
  });

  const openAgents = useCallback(
    (taskId: string, role: AgentRole): void => {
      const params = new URLSearchParams({
        task: taskId,
        agent: role,
      });
      navigate(`/agents?${params.toString()}`);
    },
    [navigate],
  );

  const openSessionInAgentStudio = useCallback(
    (intent: KanbanSessionStartIntent, session: AgentSessionIdentity): void => {
      const params = new URLSearchParams({
        task: intent.taskId,
        session: session.externalSessionId,
        agent: intent.role,
      });
      navigate(`/agents?${params.toString()}`);
    },
    [navigate],
  );

  const startSessionIntent = useCallback(
    async (intent: KanbanSessionStartIntent): Promise<AgentSessionIdentity | undefined> => {
      if (openAgentStudioTabOnBackgroundSessionStart === null) {
        throw new Error("Cannot start Kanban session because settings have not loaded.");
      }

      const selectedTask = tasks.find((task) => task.id === intent.taskId) ?? null;
      const taskSessions = sessions.filter((session) => session.taskId === intent.taskId);
      return runSessionStartRequest(
        buildSessionStartModalRequest({
          source: "kanban",
          request: intent,
          selectedModel: null,
          taskSessions,
          selectedTask,
        }),
        async ({ decision, runInBackground }) => {
          const session = await startKanbanSessionFlow({
            workspaceId: activeWorkspaceId,
            request: intent,
            decision,
            startInBackground: runInBackground,
            openAgentStudioTabOnBackgroundSessionStart,
            tasks,
            roleLabels: ROLE_LABELS,
            runSessionStartWorkflow,
            humanRequestChangesTask,
            ...(setTaskTargetBranch ? { setTaskTargetBranch } : {}),
            openSessionInAgentStudio,
          });
          return session;
        },
      );
    },
    [
      humanRequestChangesTask,
      openAgentStudioTabOnBackgroundSessionStart,
      openSessionInAgentStudio,
      runSessionStartWorkflow,
      runSessionStartRequest,
      setTaskTargetBranch,
      sessions,
      tasks,
      activeWorkspaceId,
    ],
  );

  const closeHumanReviewFeedbackModal = useCallback((): void => {
    if (isSubmittingHumanReviewFeedback) {
      return;
    }

    clearHumanReviewFeedback();
  }, [clearHumanReviewFeedback, isSubmittingHumanReviewFeedback]);

  const onPullRequestGenerate = useCallback(
    async (taskId: string): Promise<string | undefined> => {
      const builderSessions = findSessionsByRoleForTask(sessions, taskId, "build");
      if (builderSessions.length === 0) {
        throw new Error(`No Builder session is available to fork or reuse for task "${taskId}".`);
      }

      const session = await startSessionIntent({
        taskId,
        role: "build",
        launchActionId: "build_pull_request_generation",
        initialSourceSession: builderSessions[0]
          ? toAgentSessionIdentity(builderSessions[0])
          : null,
        existingSessionOptions: buildReusableSessionOptions({
          sessions: builderSessions,
          role: "build",
        }),
        postStartAction: "kickoff",
      });
      return session?.externalSessionId;
    },
    [sessions, startSessionIntent],
  );

  const onDelegate = useCallback(
    (taskId: string): void => {
      void startSessionIntent({
        taskId,
        role: "build",
        launchActionId: resolveBuildContinuationLaunchAction(
          tasks.find((entry) => entry.id === taskId) ?? null,
        ),
        postStartAction: "kickoff",
      });
    },
    [startSessionIntent, tasks],
  );

  const onOpenSession = useCallback(
    (taskId: string, role: AgentRole, options?: SessionTargetOptions): void => {
      if (options?.session) {
        openSessionInAgentStudio(
          { taskId, role, launchActionId: firstLaunchAction(role), postStartAction: "none" },
          options.session,
        );
        return;
      }

      const preferredSessionByRole = findPreferredSessionByRoleForTask(sessions, taskId, role);
      const fallbackLatestSessionByRole = findLatestSessionByRoleForTask(sessions, taskId, role);
      const sessionToOpen = preferredSessionByRole ?? fallbackLatestSessionByRole;
      if (sessionToOpen) {
        openSessionInAgentStudio(
          { taskId, role, launchActionId: firstLaunchAction(role), postStartAction: "none" },
          sessionToOpen,
        );
        return;
      }

      openAgents(taskId, role);
    },
    [openAgents, openSessionInAgentStudio, sessions],
  );

  const onPlan = useCallback(
    (taskId: string, action: "set_spec" | "set_plan"): void => {
      const role: AgentRole = action === "set_spec" ? "spec" : "planner";
      const startPreference = resolveKanbanPlanningStartPreference(tasks, taskId, action);

      if (action === "set_spec" && startPreference === "continue") {
        onOpenSession(taskId, "spec");
        return;
      }

      void startSessionIntent({
        taskId,
        role,
        launchActionId: firstLaunchAction(role),
        postStartAction: startPreference === "fresh" ? "kickoff" : "none",
      });
    },
    [onOpenSession, startSessionIntent, tasks],
  );

  const onBuild = useCallback(
    (taskId: string): void => {
      onOpenSession(taskId, "build");
    },
    [onOpenSession],
  );

  const onQaStart = useCallback(
    (taskId: string): void => {
      void startSessionIntent({
        taskId,
        role: "qa",
        launchActionId: "qa_review",
        postStartAction: "kickoff",
      });
    },
    [startSessionIntent],
  );

  const onQaOpen = useCallback(
    (taskId: string): void => {
      onOpenSession(taskId, "qa");
    },
    [onOpenSession],
  );

  const onHumanRequestChanges = useCallback(
    (taskId: string): void => {
      openHumanReviewFeedback(taskId);
    },
    [openHumanReviewFeedback],
  );

  const confirmHumanReviewFeedback = useCallback(async (): Promise<void> => {
    if (!humanReviewFeedbackState) {
      return;
    }

    setIsSubmittingHumanReviewFeedback(true);
    try {
      const result = await submitHumanReviewFeedback({
        state: humanReviewFeedbackState,
        builderSessions: findSessionsByRoleForTask(
          sessions,
          humanReviewFeedbackState.taskId,
          "build",
        ),
        startRequestChangesSession: (request) =>
          startSessionIntent({
            taskId: request.taskId,
            role: request.role,
            launchActionId: request.launchActionId,
            ...(request.initialStartMode ? { initialStartMode: request.initialStartMode } : {}),
            existingSessionOptions: request.existingSessionOptions,
            ...(request.initialSourceSession !== undefined
              ? { initialSourceSession: request.initialSourceSession }
              : {}),
            postStartAction: request.postStartAction,
            message: request.message,
            beforeStartAction: request.beforeStartAction,
          }),
      });
      if (result.outcome === "started") {
        clearHumanReviewFeedback();
      }
    } catch (error) {
      toast.error("Failed to prepare the Builder session.", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSubmittingHumanReviewFeedback(false);
    }
  }, [clearHumanReviewFeedback, humanReviewFeedbackState, sessions, startSessionIntent]);

  const humanReviewFeedbackModal = useMemo<HumanReviewFeedbackModalModel | null>(() => {
    if (!humanReviewFeedbackState) {
      return null;
    }

    return buildHumanReviewFeedbackModalModel({
      state: humanReviewFeedbackState,
      isSubmitting: isSubmittingHumanReviewFeedback,
      onDismiss: closeHumanReviewFeedbackModal,
      onMessageChange: (message: string) => {
        setHumanReviewFeedbackState((current) => (current ? { ...current, message } : current));
      },
      onConfirm: confirmHumanReviewFeedback,
    });
  }, [
    closeHumanReviewFeedbackModal,
    confirmHumanReviewFeedback,
    humanReviewFeedbackState,
    isSubmittingHumanReviewFeedback,
    setHumanReviewFeedbackState,
  ]);

  return {
    humanReviewFeedbackModal,
    sessionStartModal,
    startSessionIntent,
    onPullRequestGenerate,
    onDelegate,
    onOpenSession,
    onPlan,
    onQaStart,
    onQaOpen,
    onBuild,
    onHumanRequestChanges,
  };
}
