import type {
  AgentSessionModelSelection,
  GitTargetBranch,
  RuntimeKind,
  WorkspaceSession,
  WorkspaceSessionActivity,
  WorkspaceSessionExecutionTarget,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { TaskStoreError } from "./task-repository-ports";

export type WorkspaceSessionStoreScope = { repoPath: string; workspaceId: string };
export type WorkspaceSessionStoreRef = WorkspaceSessionStoreScope & { sessionId: string };
export type RuntimeOwnershipScope = {
  catalogRevision: number;
  workspaces: readonly WorkspaceSessionStoreScope[];
};
/** Lists the workspaces of one cross-workspace read. The read admits each one. */
type WorkspaceSessionStoreScopes = { workspaces: readonly WorkspaceSessionStoreScope[] };
type Result<A = WorkspaceSession> = Effect.Effect<A, TaskStoreError>;

export type RuntimeSessionOwner = {
  runtimeKind: RuntimeKind;
  externalSessionId: string;
} & (
  | { kind: "workspace"; sessionId: string; archived: boolean }
  | { kind: "task"; taskId: string; role: string }
);

export type WorkspaceRuntimeSessionOwner = RuntimeSessionOwner & { workspaceId: string };

export type RuntimeOwnerFilter = {
  runtimeKind: RuntimeKind;
  externalSessionIds: readonly string[];
};

/** The saved chat columns that decide if a chat needs a worktree. */
export type WorktreeOwnershipChat = Pick<
  WorkspaceSession,
  "id" | "runtimeKind" | "externalSessionId" | "generatedTitle" | "manualTitle" | "archivedAt"
> & { workspaceId: string; workingDirectory: string };

export type RuntimeSessionMatch = WorkspaceSessionStoreScope & { session: WorkspaceSession };

/** A native conversation that an active chat or an open task owns. */
export type LiveSessionRoot = {
  sessionScope:
    | { kind: "repository"; workspaceId: string }
    | { kind: "workflow"; workspaceId: string; taskId: string; role: string };
  runtimeKind: RuntimeKind;
  externalSessionId: string;
  workingDirectory: string;
};

export type WorkspaceSessionStorePort = {
  /**
   * Reads the owners of the workspace. With an ownership scope, reads the owners of every
   * workspace in it, after the read checks the scope like an ownership claim.
   */
  listRuntimeOwners(
    input: WorkspaceSessionStoreScope & {
      filter?: RuntimeOwnerFilter;
      ownershipScope?: RuntimeOwnershipScope;
    },
  ): Result<WorkspaceRuntimeSessionOwner[]>;
  importSession(
    input: WorkspaceSessionStoreScope & {
      session: WorkspaceSession;
      ownershipScope: RuntimeOwnershipScope;
    },
  ): Result<{ session: WorkspaceSession; created: boolean }>;

  get(input: WorkspaceSessionStoreRef): Result;
  listIds(input: WorkspaceSessionStoreScope): Result<string[]>;
  listActive(input: WorkspaceSessionStoreScope): Result<WorkspaceSession[]>;
  /** Reads all saved chats without an archive limit. Allows closed workspaces and unavailable roots. */
  listForWorktreeOwnership(input: WorkspaceSessionStoreScopes): Result<WorktreeOwnershipChat[]>;
  /** Reads the native conversations of active chats and open tasks. */
  listLiveSessionRoots(input: WorkspaceSessionStoreScopes): Result<LiveSessionRoot[]>;
  listArchived(input: WorkspaceSessionStoreScope): Result<WorkspaceSession[]>;
  /** Reads the saved chats of one native conversation, at most one in each workspace. */
  findByRuntimeSession(
    input: WorkspaceSessionStoreScopes & { runtimeKind: RuntimeKind; externalSessionId: string },
  ): Result<RuntimeSessionMatch[]>;
  create(
    input: WorkspaceSessionStoreScope & {
      session: WorkspaceSession;
      ownershipScope?: RuntimeOwnershipScope;
    },
  ): Result;
  bindRuntimeSession(
    input: WorkspaceSessionStoreRef & {
      externalSessionId: string;
      ownershipScope: RuntimeOwnershipScope;
    },
  ): Result;
  setExecutionTarget(
    input: WorkspaceSessionStoreRef & { executionTarget: WorkspaceSessionExecutionTarget },
  ): Result;
  rename(input: WorkspaceSessionStoreRef & { manualTitle: string | null }): Result;
  /**
   * Writes a manual title that an Operation already persisted. The value came from the
   * store, so it can exceed the manual title input limit. Use it to restore a title.
   */
  setPersistedTitle(input: WorkspaceSessionStoreRef & { manualTitle: string | null }): Result;
  archive(
    input: WorkspaceSessionStoreRef & {
      archivedAt: number;
      executionTarget?: WorkspaceSessionExecutionTarget;
    },
  ): Result;
  restore(
    input: WorkspaceSessionStoreRef & { executionTarget?: WorkspaceSessionExecutionTarget },
  ): Result;
  setTargetBranch(input: WorkspaceSessionStoreRef & { targetBranch: GitTargetBranch }): Result;
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
