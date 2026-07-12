import type {
  AgentRole,
  AgentSessionRecord,
  PlanSubtaskInput,
  PullRequest,
  TaskCreateInput,
  TaskDirectMergeInput,
  TaskStatus,
  TaskUpdatePatch,
} from "@openducktor/contracts";

export type RepoPathInput = {
  repoPath: string;
};

export type TaskIdInput = RepoPathInput & {
  taskId: string;
};

export type ListTasksInput = RepoPathInput & {
  doneVisibleDays?: number;
};

export type AgentSessionUpsertInput = TaskIdInput & {
  session: AgentSessionRecord;
};

export type PullRequestNumberInput = TaskIdInput & {
  providerId: string;
  number: number;
};

export type PullRequestUpsertInput = TaskIdInput & {
  content: {
    title: string;
    body: string;
  };
};

export type PullRequestLinkMergedInput = TaskIdInput & {
  pullRequest: PullRequest;
};

export type DirectMergeInput = TaskIdInput & {
  input: TaskDirectMergeInput;
};

export type CreateTaskUseCaseInput = RepoPathInput & {
  task: TaskCreateInput;
};

export type DeleteTaskInput = TaskIdInput & {
  deleteSubtasks: boolean;
};

export type UpdateTaskInput = TaskIdInput & {
  patch: TaskUpdatePatch;
};

export type TransitionTaskInput = TaskIdInput & {
  status: TaskStatus;
};

export type MarkdownDocumentInput = TaskIdInput & {
  markdown: string;
};

export type SetPlanInput = TaskIdInput & {
  markdown: string;
  subtasks: PlanSubtaskInput[];
  hasExplicitSubtasks: boolean;
};

export type BuildStartInput = TaskIdInput & {
  runtimeKind: string;
};

export type TaskSessionBootstrapPrepareInput = BuildStartInput & {
  role: AgentRole;
  targetWorkingDirectory?: string;
};

export type TaskSessionBootstrapFinalizeInput = TaskIdInput & {
  bootstrapId: string;
};

export type TaskSessionStartupLeasePrepareInput = TaskIdInput & { role: AgentRole };
export type TaskSessionStartupLeaseFinalizeInput = TaskIdInput & { leaseId: string };

export type BuildBlockedInput = TaskIdInput & {
  reason: string;
};

export type BuildCompletedInput = TaskIdInput & {
  summary?: string;
};

export type OptionalNoteInput = TaskIdInput & {
  note?: string;
};
