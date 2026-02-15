import type {
  BeadsCheck,
  RunEvent,
  RunSummary,
  RuntimeCheck,
  SystemCheck,
  TaskCard,
  TaskCreateInput,
  TaskPhase,
  TaskUpdatePatch,
  WorkspaceRecord,
} from "@openblueprint/contracts";

export type RepoSettingsInput = {
  worktreeBasePath: string;
  branchPrefix: string;
  trustedHooks: boolean;
  preStartHooks: string[];
  postCompleteHooks: string[];
};

export type OrchestratorContextValue = {
  statusText: string;
  runtimeCheck: RuntimeCheck | null;
  beadsCheck: BeadsCheck | null;
  systemCheck: SystemCheck | null;
  isSwitchingWorkspace: boolean;
  switchingRepoPath: string | null;
  isLoadingTasks: boolean;
  isLoadingChecks: boolean;
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
  createTask: (input: TaskCreateInput) => Promise<void>;
  updateTask: (taskId: string, patch: TaskUpdatePatch) => Promise<void>;
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
  loadRepoSettings: () => Promise<RepoSettingsInput>;
  saveRepoSettings: (input: RepoSettingsInput) => Promise<void>;
  activeWorkspace: WorkspaceRecord | null;
};
