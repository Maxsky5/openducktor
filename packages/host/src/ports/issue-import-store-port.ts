import type { SourceIssueReference, TaskCreateInput } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { TaskStoreError, TaskRecord } from "./task-repository-ports";

export type IssueImportStorePort = {
  getSourceIssue(input: {
    repoPath: string;
    taskId: string;
  }): Effect.Effect<
    (SourceIssueReference & { description: string | null }) | undefined,
    TaskStoreError
  >;
  findLinkedTaskIds(input: {
    repoPath: string;
    providerId: string;
    scope: string;
    sourceIds: string[];
  }): Effect.Effect<Record<string, string>, TaskStoreError>;
  findSourceScopes(input: {
    repoPath: string;
    providerId: string;
    scope: string;
    sourceIds: string[];
  }): Effect.Effect<string[], TaskStoreError>;
  replaceSourceScope(input: {
    repoPath: string;
    providerId: string;
    oldScope: string;
    scope: string;
    sourceIds: string[];
  }): Effect.Effect<void, TaskStoreError>;
  createImportedTask(input: {
    repoPath: string;
    sourceIssue: SourceIssueReference;
    task: TaskCreateInput;
    /** The initial state of the task workflow. */
    status: string;
  }): Effect.Effect<
    { outcome: "created"; task: TaskRecord } | { outcome: "duplicate"; taskId: string },
    TaskStoreError
  >;
};
