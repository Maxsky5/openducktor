import type { SourceIssueReference, TaskCard, TaskCreateInput } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { TaskStoreError } from "./task-repository-ports";

export type IssueImportStorePort = {
  getSourceIssue(input: {
    repoPath: string;
    taskId: string;
  }): Effect.Effect<SourceIssueReference | undefined, TaskStoreError>;
  findLinkedTaskIds(input: {
    repoPath: string;
    providerId: string;
    scope: string;
    sourceIds: string[];
  }): Effect.Effect<Record<string, string>, TaskStoreError>;
  createImportedTask(input: {
    repoPath: string;
    sourceIssue: SourceIssueReference;
    task: TaskCreateInput;
  }): Effect.Effect<
    { outcome: "created"; task: TaskCard } | { outcome: "duplicate"; taskId: string },
    TaskStoreError
  >;
};
