import type {
  AgentSessionIdentity,
  AgentSessionRecord,
  DirectMergeRecord,
  PullRequest,
  QaReportVerdict,
  RepoStoreHealth,
  TaskAgentSessions,
  TaskArtifact,
  TaskAssetDescriptionMutation,
  TaskCard,
  TaskCreateInput,
  TaskMetadataArtifact,
  TaskMetadataPayload,
  TaskStatus,
  TaskUpdatePatch,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type {
  HostDependencyErrorAggregate,
  HostInvariantErrorAggregate,
  HostOperationErrorAggregate,
  HostPathAccessErrorAggregate,
  HostPathNotFoundErrorAggregate,
  HostResourceErrorAggregate,
  HostValidationErrorAggregate,
} from "../effect/host-errors";
import type { TaskAssetError } from "../effect/task-asset-error";

export type TaskStoreError =
  | TaskAssetError
  | HostDependencyErrorAggregate
  | HostInvariantErrorAggregate
  | HostOperationErrorAggregate
  | HostPathAccessErrorAggregate
  | HostPathNotFoundErrorAggregate
  | HostResourceErrorAggregate
  | HostValidationErrorAggregate;

export type TaskStoreListTasksInput = {
  repoPath: string;
  doneVisibleDays?: number;
  /** Read these tasks and their parents for a committed change event. */
  taskIds?: readonly string[];
};
export type PullRequestSyncCandidate = {
  id: string;
  pullRequest: PullRequest;
  status: TaskStatus;
};
export type TaskReference = Pick<TaskCard, "id" | "title">;
export type TaskQaOutcomeResult = { task: TaskCard; artifact: TaskMetadataArtifact };
export type TaskReader = {
  findTask(input: {
    repoPath: string;
    taskId: string;
  }): Effect.Effect<TaskCard | null, TaskStoreError>;
  /** Read IDs and titles in listTasks order without loading cards. */
  listTaskReferences(input: { repoPath: string }): Effect.Effect<TaskReference[], TaskStoreError>;
  getTask(input: { repoPath: string; taskId: string }): Effect.Effect<TaskCard, TaskStoreError>;
  getTaskMetadata(input: {
    repoPath: string;
    taskId: string;
  }): Effect.Effect<TaskMetadataPayload, TaskStoreError>;
  /** Read every task ID in listTasks order, including all closed tasks. */
  listTaskIds(input: { repoPath: string }): Effect.Effect<string[], TaskStoreError>;
  listTasks(input: TaskStoreListTasksInput): Effect.Effect<TaskCard[], TaskStoreError>;
};
export type TaskWriter = {
  createTask(input: {
    repoPath: string;
    task: TaskCreateInput;
    descriptionAssets?: TaskAssetDescriptionMutation;
  }): Effect.Effect<TaskCard, TaskStoreError>;
  deleteTask(input: {
    repoPath: string;
    taskId: string;
    deleteSubtasks: boolean;
    expectedTaskIds?: readonly string[];
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
    descriptionAssets?: TaskAssetDescriptionMutation;
  }): Effect.Effect<TaskCard, TaskStoreError>;
};
export type WorkflowArtifactRepository = {
  clearQaReports(input: {
    repoPath: string;
    taskId: string;
  }): Effect.Effect<boolean, TaskStoreError>;
  clearTaskArtifacts(input: {
    repoPath: string;
    taskId: string;
  }): Effect.Effect<boolean, TaskStoreError>;
  recordQaOutcome(input: {
    repoPath: string;
    taskId: string;
    status: TaskStatus;
    markdown: string;
    verdict: QaReportVerdict;
  }): Effect.Effect<TaskQaOutcomeResult, TaskStoreError>;
  setPlanArtifact(input: {
    repoPath: string;
    taskId: string;
    markdown: string;
  }): Effect.Effect<TaskMetadataArtifact, TaskStoreError>;
  setSpecArtifact(input: {
    repoPath: string;
    taskId: string;
    markdown: string;
  }): Effect.Effect<TaskMetadataArtifact, TaskStoreError>;
};
export type ArtifactStoreScope = { repoPath: string; taskId: string };
export type ArtifactStoreReference = ArtifactStoreScope & { artifactId: string };
export type ArtifactStoreContent = {
  content: Uint8Array;
  fileName: string;
  mediaType: string;
};
export type StoredArtifactContent = {
  artifact: TaskArtifact;
  content: Uint8Array;
  version: string;
};
export type TaskArtifactRepository = {
  listArtifacts(input: ArtifactStoreScope): Effect.Effect<TaskArtifact[], TaskStoreError>;
  readArtifact(
    input: ArtifactStoreReference,
  ): Effect.Effect<StoredArtifactContent | null, TaskStoreError>;
  createArtifact(
    input: ArtifactStoreScope & ArtifactStoreContent & { name: string; code?: string | undefined },
  ): Effect.Effect<TaskArtifact, TaskStoreError>;
  renameArtifact(
    input: ArtifactStoreReference & { name: string },
  ): Effect.Effect<TaskArtifact, TaskStoreError>;
  replaceArtifact(
    input: ArtifactStoreReference & ArtifactStoreContent & { name?: string | undefined },
  ): Effect.Effect<TaskArtifact, TaskStoreError>;
  deleteArtifact(input: ArtifactStoreReference): Effect.Effect<boolean, TaskStoreError>;
};
export type AgentSessionRepository = {
  recordAgentSessionActivity(input: {
    repoPath: string;
    identity: AgentSessionIdentity;
    occurredAt: number;
  }): Effect.Effect<TaskAgentSessions | null, TaskStoreError>;
  listAgentSessionsForTasks(input: {
    repoPath: string;
    taskIds: string[];
  }): Effect.Effect<TaskAgentSessions[], TaskStoreError>;
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
  updateAgentSessionModel(input: {
    repoPath: string;
    taskId: string;
    identity: AgentSessionIdentity;
    selectedModel: AgentSessionRecord["selectedModel"];
  }): Effect.Effect<boolean, TaskStoreError>;
  deleteAgentSession(input: {
    repoPath: string;
    taskId: string;
    identity: AgentSessionIdentity;
  }): Effect.Effect<boolean, TaskStoreError>;
};
export type PullRequestRepository = {
  listPullRequestSyncCandidates(input: {
    repoPath: string;
  }): Effect.Effect<PullRequestSyncCandidate[], TaskStoreError>;
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
  TaskArtifactRepository &
  DirectMergeRepository &
  PullRequestRepository &
  RepoStoreDiagnostics &
  TaskReader &
  TaskWriter &
  WorkflowArtifactRepository;
