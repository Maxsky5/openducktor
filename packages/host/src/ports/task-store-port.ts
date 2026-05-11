import type {
  AgentSessionRecord,
  DirectMergeRecord,
  PullRequest,
  QaReportVerdict,
  RepoStoreHealth,
  TaskCard,
  TaskCreateInput,
  TaskMetadataDocument,
  TaskMetadataPayload,
  TaskStatus,
  TaskUpdatePatch,
} from "@openducktor/contracts";

export type TaskStoreListTasksInput = {
  repoPath: string;
  doneVisibleDays?: number;
};

export type TaskStorePort = {
  listTasks(input: TaskStoreListTasksInput): Promise<TaskCard[]>;
  getTask(input: { repoPath: string; taskId: string }): Promise<TaskCard>;
  getTaskMetadata(input: { repoPath: string; taskId: string }): Promise<TaskMetadataPayload>;
  diagnoseRepoStore?(input: { repoPath: string }): Promise<RepoStoreHealth>;
  setSpecDocument(input: {
    repoPath: string;
    taskId: string;
    markdown: string;
  }): Promise<TaskMetadataDocument>;
  setPlanDocument(input: {
    repoPath: string;
    taskId: string;
    markdown: string;
  }): Promise<TaskMetadataDocument>;
  recordQaOutcome(input: {
    repoPath: string;
    taskId: string;
    status: TaskStatus;
    markdown: string;
    verdict: QaReportVerdict;
  }): Promise<TaskCard>;
  upsertAgentSession?(input: {
    repoPath: string;
    taskId: string;
    session: AgentSessionRecord;
  }): Promise<boolean>;
  listPullRequestSyncCandidates?(input: { repoPath: string }): Promise<TaskCard[]>;
  setPullRequest?(input: {
    repoPath: string;
    taskId: string;
    pullRequest: PullRequest | null;
  }): Promise<boolean>;
  setDirectMerge?(input: {
    repoPath: string;
    taskId: string;
    directMerge: DirectMergeRecord | null;
  }): Promise<boolean>;
  clearAgentSessionsByRoles?(input: {
    repoPath: string;
    taskId: string;
    roles: string[];
  }): Promise<boolean>;
  clearWorkflowDocuments?(input: { repoPath: string; taskId: string }): Promise<boolean>;
  clearQaReports?(input: { repoPath: string; taskId: string }): Promise<boolean>;
  createTask(input: { repoPath: string; task: TaskCreateInput }): Promise<TaskCard>;
  updateTask(input: {
    repoPath: string;
    taskId: string;
    patch: TaskUpdatePatch;
  }): Promise<TaskCard>;
  transitionTask(input: {
    repoPath: string;
    taskId: string;
    status: TaskStatus;
  }): Promise<TaskCard>;
  deleteTask(input: {
    repoPath: string;
    taskId: string;
    deleteSubtasks: boolean;
  }): Promise<boolean>;
};
