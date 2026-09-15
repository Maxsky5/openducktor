import type {
  AgentSessionModelSelection,
  RuntimeKind,
  WorkspaceSession,
  WorkspaceSessionActivity,
  WorkspaceSessionExecutionTarget,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { TaskStoreError } from "./task-repository-ports";

export type WorkspaceSessionStoreScope = { repoPath: string; workspaceId: string };
export type WorkspaceSessionStoreRef = WorkspaceSessionStoreScope & { sessionId: string };
type Result<A = WorkspaceSession> = Effect.Effect<A, TaskStoreError>;

export type WorkspaceSessionStorePort = {
  get(input: WorkspaceSessionStoreRef): Result;
  listAll(input: WorkspaceSessionStoreScope): Result<WorkspaceSession[]>;
  listActive(input: WorkspaceSessionStoreScope): Result<WorkspaceSession[]>;
  listArchived(input: WorkspaceSessionStoreScope): Result<WorkspaceSession[]>;
  findByRuntimeSession(
    input: WorkspaceSessionStoreScope & { runtimeKind: RuntimeKind; externalSessionId: string },
  ): Result<WorkspaceSession | null>;
  create(input: WorkspaceSessionStoreScope & { session: WorkspaceSession }): Result;
  bindRuntimeSession(input: WorkspaceSessionStoreRef & { externalSessionId: string }): Result;
  rename(input: WorkspaceSessionStoreRef & { manualTitle: string | null }): Result;
  archive(
    input: WorkspaceSessionStoreRef & {
      archivedAt: number;
      executionTarget?: WorkspaceSessionExecutionTarget;
    },
  ): Result;
  restore(
    input: WorkspaceSessionStoreRef & { executionTarget?: WorkspaceSessionExecutionTarget },
  ): Result;
  setSelectedModel(
    input: WorkspaceSessionStoreRef & { selectedModel: AgentSessionModelSelection },
  ): Result;
  setGeneratedTitle(input: WorkspaceSessionStoreRef & { generatedTitle: string }): Result;
  recordAcceptedMessage(
    input: WorkspaceSessionStoreRef & {
      generatedTitle: string | null;
      occurredAt: number;
      selectedModel?: AgentSessionModelSelection;
    },
  ): Result;
  recordActivity(input: WorkspaceSessionStoreRef & { activity: WorkspaceSessionActivity }): Result;
};
