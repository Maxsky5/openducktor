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

export type TaskReader = {
  getTask(input: { repoPath: string; taskId: string }): Promise<TaskCard>;
  getTaskMetadata(input: { repoPath: string; taskId: string }): Promise<TaskMetadataPayload>;
  listTasks(input: TaskStoreListTasksInput): Promise<TaskCard[]>;
};

export type TaskWriter = {
  createTask(input: { repoPath: string; task: TaskCreateInput }): Promise<TaskCard>;
  deleteTask(input: {
    repoPath: string;
    taskId: string;
    deleteSubtasks: boolean;
  }): Promise<boolean>;
  transitionTask(input: {
    repoPath: string;
    taskId: string;
    status: TaskStatus;
  }): Promise<TaskCard>;
  updateTask(input: {
    repoPath: string;
    taskId: string;
    patch: TaskUpdatePatch;
  }): Promise<TaskCard>;
};

export type WorkflowDocumentRepository = {
  clearQaReports(input: { repoPath: string; taskId: string }): Promise<boolean>;
  clearWorkflowDocuments(input: { repoPath: string; taskId: string }): Promise<boolean>;
  recordQaOutcome(input: {
    repoPath: string;
    taskId: string;
    status: TaskStatus;
    markdown: string;
    verdict: QaReportVerdict;
  }): Promise<TaskCard>;
  setPlanDocument(input: {
    repoPath: string;
    taskId: string;
    markdown: string;
  }): Promise<TaskMetadataDocument>;
  setSpecDocument(input: {
    repoPath: string;
    taskId: string;
    markdown: string;
  }): Promise<TaskMetadataDocument>;
};

export type AgentSessionRepository = {
  clearAgentSessionsByRoles(input: {
    repoPath: string;
    taskId: string;
    roles: string[];
  }): Promise<boolean>;
  upsertAgentSession(input: {
    repoPath: string;
    taskId: string;
    session: AgentSessionRecord;
  }): Promise<boolean>;
};

export type PullRequestRepository = {
  listPullRequestSyncCandidates(input: { repoPath: string }): Promise<TaskCard[]>;
  setPullRequest(input: {
    repoPath: string;
    taskId: string;
    pullRequest: PullRequest | null;
  }): Promise<boolean>;
};

export type DirectMergeRepository = {
  setDirectMerge(input: {
    repoPath: string;
    taskId: string;
    directMerge: DirectMergeRecord | null;
  }): Promise<boolean>;
};

export type RepoStoreDiagnostics = {
  diagnoseRepoStore(input: { repoPath: string; prepare?: boolean }): Promise<RepoStoreHealth>;
};

export type TaskStorePort = AgentSessionRepository &
  DirectMergeRepository &
  PullRequestRepository &
  RepoStoreDiagnostics &
  TaskReader &
  TaskWriter &
  WorkflowDocumentRepository;
