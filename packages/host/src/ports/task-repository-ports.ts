import type {
  AgentSessionIdentity,
  AgentSessionRecord,
  DirectMergeRecord,
  PullRequest,
  RepoStoreHealth,
  TaskAgentSessions,
  TaskArtifact,
  TaskAssetDescriptionMutation,
  TaskCard,
  TaskCreateInput,
  TaskMetadataArtifact,
  TaskMetadataPayload,
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
import type { TransitionCause } from "@openducktor/workflows";

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
  /** Read these tasks for a committed change event. */
  taskIds?: readonly string[];
};
export type PullRequestSyncCandidate = {
  id: string;
  pullRequest: PullRequest;
  status: string;
};
export type TaskReference = Pick<TaskCard, "id" | "title">;
/** A stored task. The workflow projection adds its actions and role states. */
export type TaskRecord = Omit<TaskCard, "availableActions" | "agentWorkflows">;
export type TaskReader = {
  findTask(input: {
    repoPath: string;
    taskId: string;
  }): Effect.Effect<TaskRecord | null, TaskStoreError>;
  /** Read IDs and titles in listTasks order without loading cards. */
  listTaskReferences(input: { repoPath: string }): Effect.Effect<TaskReference[], TaskStoreError>;
  getTask(input: { repoPath: string; taskId: string }): Effect.Effect<TaskRecord, TaskStoreError>;
  getTaskMetadata(input: {
    repoPath: string;
    taskId: string;
  }): Effect.Effect<TaskMetadataPayload, TaskStoreError>;
  /** Read every task ID in listTasks order, including all closed tasks. */
  listTaskIds(input: { repoPath: string }): Effect.Effect<string[], TaskStoreError>;
  listTasks(input: TaskStoreListTasksInput): Effect.Effect<TaskRecord[], TaskStoreError>;
};
export type TaskWriter = {
  createTask(input: {
    repoPath: string;
    task: TaskCreateInput;
    /** The initial state of the task workflow. */
    status: string;
    descriptionAssets?: TaskAssetDescriptionMutation;
  }): Effect.Effect<TaskRecord, TaskStoreError>;
  deleteTask(input: { repoPath: string; taskId: string }): Effect.Effect<boolean, TaskStoreError>;
  transitionTask(input: {
    repoPath: string;
    taskId: string;
    status: string;
    cause?: TransitionCause;
  }): Effect.Effect<TaskRecord, TaskStoreError>;
  updateTask(input: {
    repoPath: string;
    taskId: string;
    patch: TaskUpdatePatch;
    descriptionAssets?: TaskAssetDescriptionMutation;
  }): Effect.Effect<TaskRecord, TaskStoreError>;
};
export type WorkflowArtifactRepository = {
  /** Deletes every revision of these workflow artifacts. */
  clearWorkflowArtifacts(input: {
    repoPath: string;
    taskId: string;
    codes: readonly string[];
  }): Effect.Effect<boolean, TaskStoreError>;
  clearTaskArtifacts(input: {
    repoPath: string;
    taskId: string;
  }): Effect.Effect<boolean, TaskStoreError>;
  /** Saves a new revision. A status commits in the same transaction. */
  saveWorkflowArtifact(
    input: WorkflowArtifactWrite,
  ): Effect.Effect<WorkflowArtifactSaveResult, TaskStoreError>;
};
export type WorkflowArtifactWrite = {
  repoPath: string;
  taskId: string;
  code: string;
  markdown: string;
  /** The command that saves the artifact, such as `odt_set_task_artifact`. */
  sourceTool: string;
  /** The role of the acting session, or `user`. */
  updatedBy: string;
  verdict?: string;
  status?: string;
  cause?: TransitionCause;
};
export type WorkflowArtifactSaveResult = { task: TaskRecord; artifact: TaskMetadataArtifact };
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
  isUtf8: boolean;
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
/** An open task and the working directories of its sessions. */
export type OpenTaskDirectories = {
  taskId: string;
  title: string;
  sessionDirectories: string[];
};

/** Reads the tasks that can own a worktree, also in a closed workspace. */
export type TaskOwnershipReader = {
  listOpenTasksForWorktreeOwnership(scope: {
    workspaceId: string;
    repoPath: string;
  }): Effect.Effect<OpenTaskDirectories[], TaskStoreError>;
};

export type TaskStorePort = AgentSessionRepository &
  TaskArtifactRepository &
  DirectMergeRepository &
  PullRequestRepository &
  RepoStoreDiagnostics &
  TaskReader &
  TaskWriter &
  WorkflowArtifactRepository;
