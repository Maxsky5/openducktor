import { subscribeRunEvents } from "@/lib/host-client";
import { errorMessage, summarizeTaskLoadError } from "@/state/orchestrator-helpers";
import {
  type RunEvent,
  defaultSpecTemplateMarkdown,
  runEventSchema,
  validateSpecMarkdown,
} from "@openblueprint/contracts";
import {
  type PropsWithChildren,
  type ReactElement,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { OrchestratorContextValue } from "./orchestrator/types";
import { useChecks } from "./orchestrator/use-checks";
import { useDelegationOperations } from "./orchestrator/use-delegation-operations";
import { useRepoSettingsOperations } from "./orchestrator/use-repo-settings-operations";
import { useSpecOperations } from "./orchestrator/use-spec-operations";
import { useTaskOperations } from "./orchestrator/use-task-operations";
import { useWorkspaceOperations } from "./orchestrator/use-workspace-operations";

export type { RepoSettingsInput } from "./orchestrator/types";

const OrchestratorContext = createContext<OrchestratorContextValue | null>(null);

export function OrchestratorProvider({ children }: PropsWithChildren): ReactElement {
  const [statusText, setStatusText] = useState("Ready");
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const repoLoadVersionRef = useRef(0);

  const {
    runtimeCheck,
    activeBeadsCheck,
    systemCheck,
    isLoadingChecks,
    setIsLoadingChecks,
    refreshRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshChecks,
    hasRuntimeCheck,
    hasCachedBeadsCheck,
    clearActiveBeadsCheck,
  } = useChecks({
    activeRepo,
    setStatusText,
  });

  const {
    tasks,
    runs,
    isLoadingTasks,
    setIsLoadingTasks,
    clearTaskData,
    refreshTaskData,
    refreshTasks,
    createTask,
    updateTask,
    setTaskPhase,
  } = useTaskOperations({
    activeRepo,
    setStatusText,
    refreshBeadsCheckForRepo,
  });

  const { delegateTask, delegateRespond, delegateStop, delegateCleanup } = useDelegationOperations({
    activeRepo,
    setStatusText,
    refreshTaskData,
  });

  const { loadSpec, saveSpec } = useSpecOperations({
    activeRepo,
    setStatusText,
  });

  const {
    workspaces,
    isSwitchingWorkspace,
    switchingRepoPath,
    refreshWorkspaces,
    addWorkspace,
    selectWorkspace,
  } = useWorkspaceOperations({
    activeRepo,
    setActiveRepo,
    setStatusText,
    setSelectedTaskId,
    clearTaskData,
    clearActiveBeadsCheck,
  });

  const { loadRepoSettings, saveRepoSettings } = useRepoSettingsOperations({
    activeRepo,
    refreshWorkspaces,
  });

  useEffect(() => {
    Promise.allSettled([refreshWorkspaces(), refreshRuntimeCheck(false)]).then(
      ([workspaceResult, runtimeResult]) => {
        if (workspaceResult.status === "rejected") {
          setStatusText(`Workspace load failed: ${errorMessage(workspaceResult.reason)}`);
          return;
        }

        if (runtimeResult.status === "rejected") {
          setStatusText(`Runtime checks unavailable: ${errorMessage(runtimeResult.reason)}`);
        }
      },
    );

    let unsubscribe: (() => void) | null = null;
    subscribeRunEvents((payload) => {
      const parsed = runEventSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      setEvents((current) => [parsed.data, ...current].slice(0, 500));
    })
      .then((cleanup) => {
        unsubscribe = cleanup;
      })
      .catch((error: unknown) => {
        setStatusText(`Run event subscription failed: ${errorMessage(error)}`);
      });

    return () => {
      unsubscribe?.();
    };
  }, [refreshRuntimeCheck, refreshWorkspaces]);

  useEffect(() => {
    if (!activeRepo) {
      clearTaskData();
      clearActiveBeadsCheck();
      setIsLoadingTasks(false);
      setIsLoadingChecks(false);
      return;
    }

    const loadVersion = ++repoLoadVersionRef.current;
    setIsLoadingTasks(true);
    setIsLoadingChecks(!hasRuntimeCheck() || !hasCachedBeadsCheck(activeRepo));
    setStatusText(`Loading repository context for ${activeRepo}...`);

    Promise.allSettled([
      (async () => {
        const beads = await refreshBeadsCheckForRepo(activeRepo, false);
        if (!beads.beadsOk) {
          throw new Error(
            beads.beadsError ?? "Beads store is not initialized for this repository.",
          );
        }

        await refreshTaskData(activeRepo);
      })(),
      refreshRuntimeCheck(false),
    ])
      .then(([tasksResult, runtimeResult]) => {
        if (repoLoadVersionRef.current !== loadVersion) {
          return;
        }

        let hasError = false;
        if (tasksResult.status === "rejected") {
          hasError = true;
          setStatusText(summarizeTaskLoadError(tasksResult.reason));
        }

        if (runtimeResult.status === "rejected") {
          hasError = true;
          setStatusText(`Failed to load runtime checks: ${errorMessage(runtimeResult.reason)}`);
        }

        if (!hasError) {
          setStatusText(`Repository ready: ${activeRepo}`);
        }
      })
      .finally(() => {
        if (repoLoadVersionRef.current !== loadVersion) {
          return;
        }

        setIsLoadingTasks(false);
        setIsLoadingChecks(false);
      });
  }, [
    activeRepo,
    clearActiveBeadsCheck,
    clearTaskData,
    hasCachedBeadsCheck,
    hasRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshRuntimeCheck,
    refreshTaskData,
    setIsLoadingChecks,
    setIsLoadingTasks,
  ]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.path === activeRepo) ?? null,
    [activeRepo, workspaces],
  );

  const value = useMemo<OrchestratorContextValue>(
    () => ({
      statusText,
      runtimeCheck,
      beadsCheck: activeBeadsCheck,
      systemCheck,
      isSwitchingWorkspace,
      switchingRepoPath,
      isLoadingTasks,
      isLoadingChecks,
      workspaces,
      activeRepo,
      tasks,
      runs,
      events,
      selectedTaskId,
      selectedTask,
      addWorkspace,
      selectWorkspace,
      refreshChecks,
      refreshTasks,
      createTask,
      updateTask,
      setTaskPhase,
      setSelectedTaskId,
      delegateTask,
      delegateRespond,
      delegateStop,
      delegateCleanup,
      loadSpec,
      saveSpec,
      validateSpec: validateSpecMarkdown,
      specTemplate: defaultSpecTemplateMarkdown,
      loadRepoSettings,
      saveRepoSettings,
      activeWorkspace,
    }),
    [
      activeBeadsCheck,
      activeRepo,
      activeWorkspace,
      addWorkspace,
      createTask,
      delegateCleanup,
      delegateRespond,
      delegateStop,
      delegateTask,
      events,
      isLoadingChecks,
      isLoadingTasks,
      isSwitchingWorkspace,
      loadRepoSettings,
      loadSpec,
      refreshChecks,
      refreshTasks,
      runs,
      runtimeCheck,
      saveRepoSettings,
      saveSpec,
      selectedTask,
      selectedTaskId,
      setTaskPhase,
      statusText,
      switchingRepoPath,
      systemCheck,
      tasks,
      updateTask,
      workspaces,
      selectWorkspace,
    ],
  );

  return <OrchestratorContext.Provider value={value}>{children}</OrchestratorContext.Provider>;
}

export const useOrchestrator = (): OrchestratorContextValue => {
  const context = useContext(OrchestratorContext);
  if (!context) {
    throw new Error("useOrchestrator must be used inside OrchestratorProvider");
  }

  return context;
};
