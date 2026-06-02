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
import { Context, type Effect } from "effect";
import type {
  HostDependencyError,
  HostInvariantError,
  HostOperationError,
  HostPathAccessError,
  HostPathNotFoundError,
  HostResourceError,
  HostValidationError,
} from "../effect/host-errors";

export type TaskStoreError =
  | HostDependencyError
  | HostInvariantError
  | HostOperationError
  | HostPathAccessError
  | HostPathNotFoundError
  | HostResourceError
  | HostValidationError;

export type TaskStoreListTasksInput = {
  repoPath: string;
  doneVisibleDays?: number;
};
export type TaskReader = {
  getTask(input: { repoPath: string; taskId: string }): Effect.Effect<TaskCard, TaskStoreError>;
  getTaskMetadata(input: {
    repoPath: string;
    taskId: string;
  }): Effect.Effect<TaskMetadataPayload, TaskStoreError>;
  listTasks(input: TaskStoreListTasksInput): Effect.Effect<TaskCard[], TaskStoreError>;
};
export type TaskWriter = {
  createTask(input: {
    repoPath: string;
    task: TaskCreateInput;
  }): Effect.Effect<TaskCard, TaskStoreError>;
  deleteTask(input: {
    repoPath: string;
    taskId: string;
    deleteSubtasks: boolean;
  }): Effect.Effect<boolean, TaskStoreError>;
  transitionTask(input: {
    repoPath: string;
    taskId: string;
    status: TaskStatus;
  }): Effect.Effect<TaskCard, TaskStoreError>;
  updateTask(input: {
    repoPath: string;
    taskId: string;
    patch: TaskUpdatePatch;
  }): Effect.Effect<TaskCard, TaskStoreError>;
};
export type WorkflowDocumentRepository = {
  clearQaReports(input: {
    repoPath: string;
    taskId: string;
  }): Effect.Effect<boolean, TaskStoreError>;
  clearWorkflowDocuments(input: {
    repoPath: string;
    taskId: string;
  }): Effect.Effect<boolean, TaskStoreError>;
  recordQaOutcome(input: {
    repoPath: string;
    taskId: string;
    status: TaskStatus;
    markdown: string;
    verdict: QaReportVerdict;
  }): Effect.Effect<TaskCard, TaskStoreError>;
  setPlanDocument(input: {
    repoPath: string;
    taskId: string;
    markdown: string;
  }): Effect.Effect<TaskMetadataDocument, TaskStoreError>;
  setSpecDocument(input: {
    repoPath: string;
    taskId: string;
    markdown: string;
  }): Effect.Effect<TaskMetadataDocument, TaskStoreError>;
};
export type AgentSessionRepository = {
  clearAgentSessionsByRoles(input: {
    repoPath: string;
    taskId: string;
    roles: string[];
  }): Effect.Effect<boolean, TaskStoreError>;
  upsertAgentSession(input: {
    repoPath: string;
    taskId: string;
    session: AgentSessionRecord;
  }): Effect.Effect<boolean, TaskStoreError>;
};
export type PullRequestRepository = {
  listPullRequestSyncCandidates(input: {
    repoPath: string;
  }): Effect.Effect<TaskCard[], TaskStoreError>;
  setPullRequest(input: {
    repoPath: string;
    taskId: string;
    pullRequest: PullRequest | null;
  }): Effect.Effect<boolean, TaskStoreError>;
};
export type DirectMergeRepository = {
  setDirectMerge(input: {
    repoPath: string;
    taskId: string;
    directMerge: DirectMergeRecord | null;
  }): Effect.Effect<boolean, TaskStoreError>;
};
export type RepoStoreDiagnostics = {
  diagnoseRepoStore(input: {
    repoPath: string;
    prepare?: boolean;
  }): Effect.Effect<RepoStoreHealth, TaskStoreError>;
};
export type TaskStorePort = AgentSessionRepository &
  DirectMergeRepository &
  PullRequestRepository &
  RepoStoreDiagnostics &
  TaskReader &
  TaskWriter &
  WorkflowDocumentRepository;

class TaskStorePortTag extends Context.Tag("@openducktor/host/TaskStorePort")<
  TaskStorePortTag,
  TaskStorePort
>() {}
