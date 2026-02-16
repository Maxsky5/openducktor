import type {
  BeadsCheck,
  RunEvent,
  RunSummary,
  RuntimeCheck,
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

export type WorkspaceStateContextValue = {
  isSwitchingWorkspace: boolean;
  workspaces: WorkspaceRecord[];
  activeRepo: string | null;
  activeWorkspace: WorkspaceRecord | null;
  addWorkspace: (repoPath: string) => Promise<void>;
  selectWorkspace: (repoPath: string) => Promise<void>;
  loadRepoSettings: () => Promise<RepoSettingsInput>;
  saveRepoSettings: (input: RepoSettingsInput) => Promise<void>;
};

export type ChecksStateContextValue = {
  runtimeCheck: RuntimeCheck | null;
  beadsCheck: BeadsCheck | null;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
};

export type TasksStateContextValue = {
  isLoadingTasks: boolean;
  tasks: TaskCard[];
  runs: RunSummary[];
  refreshTasks: () => Promise<void>;
  createTask: (input: TaskCreateInput) => Promise<void>;
  updateTask: (taskId: string, patch: TaskUpdatePatch) => Promise<void>;
  setTaskPhase: (taskId: string, phase: TaskPhase) => Promise<void>;
};

export type DelegationStateContextValue = {
  events: RunEvent[];
  delegateTask: (taskId: string) => Promise<void>;
  delegateRespond: (
    runId: string,
    action: "approve" | "deny" | "message",
    payload?: string,
  ) => Promise<void>;
  delegateStop: (runId: string) => Promise<void>;
  delegateCleanup: (runId: string, mode: "success" | "failure") => Promise<void>;
};

export type SpecStateContextValue = {
  loadSpec: (taskId: string) => Promise<string>;
  saveSpec: (taskId: string, markdown: string) => Promise<{ updatedAt: string }>;
};
