import type {
  AgentSessionIdentity,
  AgentSessionRecord,
  PullRequest,
  TaskAssetDescriptionMutation,
  TaskCreateInput,
  TaskDirectMergeInput,
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
  /** Read these tasks for a committed change event. */
  taskIds?: readonly string[];
};

export type ListAgentSessionsForTasksInput = RepoPathInput & {
  taskIds: string[];
};

export type AgentSessionUpsertInput = TaskIdInput & {
  session: AgentSessionRecord;
};

export type AgentSessionUpdateModelInput = TaskIdInput & {
  identity: AgentSessionIdentity;
  selectedModel: AgentSessionRecord["selectedModel"];
};

export type AgentSessionDeleteInput = TaskIdInput & {
  identity: AgentSessionIdentity;
};

export type PullRequestNumberInput = TaskIdInput & {
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
  descriptionAssets?: TaskAssetDescriptionMutation;
};

export type DeleteTaskInput = TaskIdInput;

export type UpdateTaskInput = TaskIdInput & {
  patch: TaskUpdatePatch;
  descriptionAssets?: TaskAssetDescriptionMutation;
};

export type TransitionTaskInput = TaskIdInput & {
  status: string;
};

/** A workflow event that an event action sends. A host effect event has its own command. */
export type ApplyTaskEventInput = TaskIdInput & {
  eventId: string;
};

export type WorkflowArtifactInput = TaskIdInput & {
  code: string;
};

/**
 * A submit sends the event that the artifact or its verdict declares. A save without submit
 * changes only a document.
 */
export type WorkflowArtifactSaveInput = WorkflowArtifactInput & {
  markdown: string;
  verdict?: string;
  submit: boolean;
  /** The command that saves the artifact, such as `odt_set_task_artifact`. */
  sourceTool: string;
  /** The role of the acting session, or `user`. */
  updatedBy: string;
};

export type BuildStartInput = TaskIdInput & {
  runtimeKind: string;
};

export type BuildBlockedInput = TaskIdInput & {
  reason: string;
};

export type BuildCompletedInput = TaskIdInput & {
  summary?: string;
};

export type OptionalNoteInput = TaskIdInput & {
  note?: string;
};
