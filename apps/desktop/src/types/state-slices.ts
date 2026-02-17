import type {
  BeadsCheck,
  RunEvent,
  RunSummary,
  RuntimeCheck,
  TaskCard,
  TaskCreateInput,
  TaskStatus,
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
  transitionTask: (taskId: string, status: TaskStatus, reason?: string) => Promise<void>;
  deferTask: (taskId: string) => Promise<void>;
  resumeDeferredTask: (taskId: string) => Promise<void>;
  humanApproveTask: (taskId: string) => Promise<void>;
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
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
  loadSpecDocument: (taskId: string) => Promise<{ markdown: string; updatedAt: string | null }>;
  loadPlanDocument: (taskId: string) => Promise<{ markdown: string; updatedAt: string | null }>;
  loadQaReportDocument: (taskId: string) => Promise<{ markdown: string; updatedAt: string | null }>;
  saveSpec: (taskId: string, markdown: string) => Promise<{ updatedAt: string }>;
};
