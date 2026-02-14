import { createHostClient, subscribeRunEvents } from "@/lib/host-client";
import {
  type BeadsCheck,
  type RunEvent,
  type RunSummary,
  type RuntimeCheck,
  type SystemCheck,
  type TaskCard,
  type TaskPhase,
  type WorkspaceRecord,
  defaultSpecTemplateMarkdown,
  runEventSchema,
  taskPhaseSchema,
  validateSpecMarkdown,
} from "@openblueprint/contracts";
import {
  type PropsWithChildren,
  type ReactElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const host = createHostClient();

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
};

const TASK_STORE_HINT =
  "OpenBlueprint uses centralized Beads at ~/.openblueprint/beads/<repo-id>/.beads. Initialization is automatic on repo open; retry if this is the first load.";

const summarizeTaskLoadError = (error: unknown): string => {
  const message = (errorMessage(error).split("\n").at(0) ?? "Unknown error").trim();
  const beadsFailure = /beads|beads_dir|\bbd\b|task store/i.test(message);
  if (beadsFailure) {
    return `Task store unavailable. ${message} ${TASK_STORE_HINT}`;
  }
  return `Task store unavailable. ${message}`;
};

export type RepoSettingsInput = {
  worktreeBasePath: string;
  branchPrefix: string;
  trustedHooks: boolean;
  preStartHooks: string[];
  postCompleteHooks: string[];
};

type OrchestratorContextValue = {
  statusText: string;
  runtimeCheck: RuntimeCheck | null;
  beadsCheck: BeadsCheck | null;
  systemCheck: SystemCheck | null;
  isBusy: boolean;
  isSwitchingWorkspace: boolean;
  switchingRepoPath: string | null;
  isLoadingTasks: boolean;
  isLoadingChecks: boolean;
  isRepositoryLoading: boolean;
  workspaces: WorkspaceRecord[];
  activeRepo: string | null;
  tasks: TaskCard[];
  runs: RunSummary[];
  events: RunEvent[];
  selectedTaskId: string | null;
  selectedTask: TaskCard | null;
  addWorkspace: (repoPath: string) => Promise<void>;
  selectWorkspace: (repoPath: string) => Promise<void>;
  refreshChecks: () => Promise<void>;
  refreshTasks: () => Promise<void>;
  createTask: (title: string) => Promise<void>;
  setTaskPhase: (taskId: string, phase: TaskPhase) => Promise<void>;
  setSelectedTaskId: (taskId: string | null) => void;
  delegateTask: (taskId: string) => Promise<void>;
  delegateRespond: (
    runId: string,
    action: "approve" | "deny" | "message",
    payload?: string,
  ) => Promise<void>;
  delegateStop: (runId: string) => Promise<void>;
  delegateCleanup: (runId: string, mode: "success" | "failure") => Promise<void>;
  loadSpec: (taskId: string) => Promise<string>;
  saveSpec: (taskId: string, markdown: string) => Promise<{ updatedAt: string }>;
  validateSpec: (markdown: string) => { valid: boolean; missing: string[] };
  specTemplate: string;
  saveRepoSettings: (input: RepoSettingsInput) => Promise<void>;
  activeWorkspace: WorkspaceRecord | null;
};

const OrchestratorContext = createContext<OrchestratorContextValue | null>(null);

const phaseToStatus = (phase: TaskPhase): "open" | "in_progress" | "blocked" | "closed" => {
  if (phase === "in_progress") {
    return "in_progress";
  }
  if (phase === "blocked_needs_input") {
    return "blocked";
  }
  if (phase === "done") {
    return "closed";
  }
  return "open";
};

export function OrchestratorProvider({ children }: PropsWithChildren): ReactElement {
  const [statusText, setStatusText] = useState("Ready");
  const [runtimeCheck, setRuntimeCheck] = useState<RuntimeCheck | null>(null);
  const [activeBeadsCheck, setActiveBeadsCheck] = useState<BeadsCheck | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);
  const [switchingRepoPath, setSwitchingRepoPath] = useState<string | null>(null);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [isLoadingChecks, setIsLoadingChecks] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const workspaceSwitchVersionRef = useRef(0);
  const repoLoadVersionRef = useRef(0);
  const runtimeCheckRef = useRef<RuntimeCheck | null>(null);
  const beadsCheckCacheRef = useRef<Map<string, BeadsCheck>>(new Map());

  const refreshWorkspaces = useCallback(async (): Promise<void> => {
    const data = await host.workspaceList();
    setWorkspaces(data);
    const active = data.find((entry) => entry.isActive);
    setActiveRepo(active?.path ?? null);
  }, []);

  const refreshTaskData = useCallback(async (repoPath: string): Promise<void> => {
    const [taskList, runList] = await Promise.all([
      host.tasksList(repoPath),
      host.runsList(repoPath),
    ]);
    setTasks(taskList.filter((task) => task.issueType !== "epic"));
    setRuns(runList);
  }, []);

  const refreshRuntimeCheck = useCallback(async (force = false): Promise<RuntimeCheck> => {
    if (!force && runtimeCheckRef.current) {
      return runtimeCheckRef.current;
    }
    const check = await host.runtimeCheck();
    runtimeCheckRef.current = check;
    setRuntimeCheck(check);
    return check;
  }, []);

  const refreshBeadsCheckForRepo = useCallback(
    async (repoPath: string, force = false): Promise<BeadsCheck> => {
      const cached = beadsCheckCacheRef.current.get(repoPath);
      if (cached && !force) {
        return cached;
      }

      const check = await host.beadsCheck(repoPath);
      beadsCheckCacheRef.current.set(repoPath, check);
      if (repoPath === activeRepo) {
        setActiveBeadsCheck(check);
      }
      return check;
    },
    [activeRepo],
  );

  const refreshChecks = useCallback(async (): Promise<void> => {
    if (!activeRepo) {
      return;
    }

    setIsLoadingChecks(true);
    setStatusText(`Refreshing checks for ${activeRepo}...`);
    try {
      const runtime = await refreshRuntimeCheck(false);
      const beads = await refreshBeadsCheckForRepo(activeRepo, false);
      if (!runtime.gitOk || !runtime.opencodeOk || !beads.beadsOk) {
        const details = [
          ...runtime.errors,
          ...(beads.beadsError ? [`beads: ${beads.beadsError}`] : []),
        ].join(" | ");
        setStatusText(`System check issues: ${details}`);
      } else {
        setStatusText("System checks passed");
      }
    } finally {
      setIsLoadingChecks(false);
    }
  }, [activeRepo, refreshBeadsCheckForRepo, refreshRuntimeCheck]);

  const refreshTasks = useCallback(async (): Promise<void> => {
    if (!activeRepo) {
      return;
    }
    setIsLoadingTasks(true);
    setStatusText(`Refreshing tasks for ${activeRepo}...`);
    try {
      const beads = await refreshBeadsCheckForRepo(activeRepo, false);
      if (!beads.beadsOk) {
        const details = beads.beadsError ?? "Beads store is not initialized for this repository.";
        setStatusText(`Task store unavailable. ${details}`);
        return;
      }
      await refreshTaskData(activeRepo);
      setStatusText("Tasks refreshed");
    } catch (error) {
      setStatusText(summarizeTaskLoadError(error));
    } finally {
      setIsLoadingTasks(false);
    }
  }, [activeRepo, refreshBeadsCheckForRepo, refreshTaskData]);

  useEffect(() => {
    setIsBusy(true);
    Promise.allSettled([refreshWorkspaces(), refreshRuntimeCheck(false)])
      .then(([workspaceResult, runtimeResult]) => {
        if (workspaceResult.status === "rejected") {
          setStatusText(`Workspace load failed: ${errorMessage(workspaceResult.reason)}`);
          return;
        }
        if (runtimeResult.status === "rejected") {
          setStatusText(`Runtime checks unavailable: ${errorMessage(runtimeResult.reason)}`);
        }
      })
      .finally(() => setIsBusy(false));

    subscribeRunEvents((payload) => {
      const parsed = runEventSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      setEvents((current) => [parsed.data, ...current].slice(0, 500));
    }).catch((error: unknown) => {
      setStatusText(`Run event subscription failed: ${errorMessage(error)}`);
    });
  }, [refreshWorkspaces, refreshRuntimeCheck]);

  useEffect(() => {
    if (!activeRepo) {
      setTasks([]);
      setRuns([]);
      setActiveBeadsCheck(null);
      setIsLoadingTasks(false);
      setIsLoadingChecks(false);
      setIsSwitchingWorkspace(false);
      setSwitchingRepoPath(null);
      return;
    }

    setActiveBeadsCheck(beadsCheckCacheRef.current.get(activeRepo) ?? null);

    const loadVersion = ++repoLoadVersionRef.current;
    setIsLoadingTasks(true);
    setIsLoadingChecks(
      runtimeCheckRef.current === null || !beadsCheckCacheRef.current.has(activeRepo),
    );
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
        setIsSwitchingWorkspace(false);
        setSwitchingRepoPath(null);
      });
  }, [activeRepo, refreshBeadsCheckForRepo, refreshRuntimeCheck, refreshTaskData]);

  const addWorkspace = useCallback(
    async (repoPath: string): Promise<void> => {
      if (!repoPath.trim()) {
        return;
      }

      setIsBusy(true);
      try {
        const workspace = await host.workspaceAdd(repoPath.trim());
        setStatusText(`Workspace added: ${workspace.path}`);
        await refreshWorkspaces();
      } finally {
        setIsBusy(false);
      }
    },
    [refreshWorkspaces],
  );

  const selectWorkspace = useCallback(
    async (repoPath: string): Promise<void> => {
      const previousRepo = activeRepo;
      const switchVersion = ++workspaceSwitchVersionRef.current;

      setSelectedTaskId(null);
      setActiveRepo(repoPath);
      setTasks([]);
      setRuns([]);
      setActiveBeadsCheck(null);
      setIsSwitchingWorkspace(true);
      setSwitchingRepoPath(repoPath);
      setStatusText(`Switching repository to ${repoPath}...`);

      try {
        await host.workspaceSelect(repoPath);
        if (workspaceSwitchVersionRef.current !== switchVersion) {
          return;
        }
        setStatusText(`Workspace selected: ${repoPath}`);
        await refreshWorkspaces();
      } catch (error) {
        if (workspaceSwitchVersionRef.current !== switchVersion) {
          return;
        }
        setStatusText(`Failed to switch workspace: ${errorMessage(error)}`);
        setIsSwitchingWorkspace(false);
        setSwitchingRepoPath(null);
        setActiveRepo(previousRepo ?? null);
        throw error;
      } finally {
        if (workspaceSwitchVersionRef.current === switchVersion) {
          setIsSwitchingWorkspace(false);
          setSwitchingRepoPath(null);
        }
      }
    },
    [activeRepo, refreshWorkspaces],
  );

  const createTask = useCallback(
    async (title: string): Promise<void> => {
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }
      if (!title.trim()) {
        return;
      }

      setIsBusy(true);
      try {
        await host.taskCreate(activeRepo, title.trim());
        setStatusText("Task created");
        await refreshTaskData(activeRepo);
      } finally {
        setIsBusy(false);
      }
    },
    [activeRepo, refreshTaskData],
  );

  const setTaskPhase = useCallback(
    async (taskId: string, phase: TaskPhase): Promise<void> => {
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }

      taskPhaseSchema.parse(phase);
      setIsBusy(true);
      try {
        await host.taskSetPhase(activeRepo, taskId, phase, "Kanban move");
        await host.taskUpdate(activeRepo, taskId, { status: phaseToStatus(phase) });
        setStatusText(`Task ${taskId} moved to ${phase}`);
        await refreshTaskData(activeRepo);
      } finally {
        setIsBusy(false);
      }
    },
    [activeRepo, refreshTaskData],
  );

  const delegateTask = useCallback(
    async (taskId: string): Promise<void> => {
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }

      setIsBusy(true);
      try {
        const run = await host.delegateStart(activeRepo, taskId);
        setStatusText(`Delegation started: ${run.runId}`);
        await refreshTaskData(activeRepo);
      } finally {
        setIsBusy(false);
      }
    },
    [activeRepo, refreshTaskData],
  );

  const delegateRespond = useCallback(
    async (runId: string, action: "approve" | "deny" | "message", payload?: string) => {
      await host.delegateRespond(runId, action, payload);
      if (activeRepo) {
        await refreshTaskData(activeRepo);
      }
    },
    [activeRepo, refreshTaskData],
  );

  const delegateStop = useCallback(
    async (runId: string) => {
      await host.delegateStop(runId);
      if (activeRepo) {
        await refreshTaskData(activeRepo);
      }
    },
    [activeRepo, refreshTaskData],
  );

  const delegateCleanup = useCallback(
    async (runId: string, mode: "success" | "failure") => {
      await host.delegateCleanup(runId, mode);
      if (activeRepo) {
        await refreshTaskData(activeRepo);
      }
    },
    [activeRepo, refreshTaskData],
  );

  const loadSpec = useCallback(
    async (taskId: string): Promise<string> => {
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }
      const spec = await host.specGet(activeRepo, taskId);
      return spec.markdown || defaultSpecTemplateMarkdown;
    },
    [activeRepo],
  );

  const saveSpec = useCallback(
    async (taskId: string, markdown: string): Promise<{ updatedAt: string }> => {
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }

      const validation = validateSpecMarkdown(markdown);
      if (!validation.valid) {
        throw new Error(`Missing required sections: ${validation.missing.join(", ")}`);
      }

      const saved = await host.setSpecMarkdown({ repoPath: activeRepo, taskId, markdown });
      setStatusText(`Specification updated for ${taskId}`);
      return saved;
    },
    [activeRepo],
  );

  const saveRepoSettings = useCallback(
    async (input: RepoSettingsInput) => {
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }

      await host.workspaceUpdateRepoConfig(activeRepo, {
        worktreeBasePath: input.worktreeBasePath,
        branchPrefix: input.branchPrefix,
        trustedHooks: input.trustedHooks,
        hooks: {
          preStart: input.preStartHooks,
          postComplete: input.postCompleteHooks,
        },
      });

      await refreshWorkspaces();
    },
    [activeRepo, refreshWorkspaces],
  );

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.path === activeRepo) ?? null,
    [activeRepo, workspaces],
  );

  const systemCheck = useMemo<SystemCheck | null>(() => {
    if (!runtimeCheck || !activeBeadsCheck) {
      return null;
    }
    const errors = [...runtimeCheck.errors];
    if (activeBeadsCheck.beadsError) {
      errors.push(`beads: ${activeBeadsCheck.beadsError}`);
    }
    return {
      gitOk: runtimeCheck.gitOk,
      gitVersion: runtimeCheck.gitVersion,
      opencodeOk: runtimeCheck.opencodeOk,
      opencodeVersion: runtimeCheck.opencodeVersion,
      beadsOk: activeBeadsCheck.beadsOk,
      beadsPath: activeBeadsCheck.beadsPath,
      beadsError: activeBeadsCheck.beadsError,
      errors,
    };
  }, [activeBeadsCheck, runtimeCheck]);

  const value = useMemo<OrchestratorContextValue>(
    () => ({
      statusText,
      runtimeCheck,
      beadsCheck: activeBeadsCheck,
      systemCheck,
      isBusy,
      isSwitchingWorkspace,
      switchingRepoPath,
      isLoadingTasks,
      isLoadingChecks,
      isRepositoryLoading: isSwitchingWorkspace || isLoadingTasks || isLoadingChecks,
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
      saveRepoSettings,
      activeWorkspace,
    }),
    [
      statusText,
      runtimeCheck,
      activeBeadsCheck,
      systemCheck,
      isBusy,
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
      setTaskPhase,
      delegateTask,
      delegateRespond,
      delegateStop,
      delegateCleanup,
      loadSpec,
      saveSpec,
      saveRepoSettings,
      activeWorkspace,
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
