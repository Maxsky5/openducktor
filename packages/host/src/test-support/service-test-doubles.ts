import { withSettingsConfigMutationTestMethods } from "./settings-config-mutations";
import { unexpectedSessionImport } from "./session-import-test-doubles";
import { unexpectedTextGeneration } from "./text-generation-test-doubles";
import { unexpectedRuntimeQueries } from "./runtime-query-test-doubles";
import { AgentSessionLiveRegistration } from "../ports/agent-session-live-adapter-port";
import { emptyWorktreeOwners } from "@openducktor/core";
import { Effect } from "effect";
import type { WorkspaceSettingsService } from "../application/workspaces/workspace-settings-service";
import type { GitPort } from "../ports/git-port";
import type { SettingsConfigPort } from "../ports/settings-config-port";
import type { WorktreeFilePort } from "../ports/worktree-file-port";
import type {
  ClaudeSessionMetadataPort,
  ClaudeWorkingDirectoryRead,
} from "../ports/claude-session-metadata-port";
import type { HostOperationError } from "../effect/host-errors";
import type { TaskWorktreeOwnerReader } from "../ports/task-worktree-owner-port";
import type {
  AgentSessionLiveAdapterBinding,
  AgentSessionRuntimeAdapterPort,
} from "../ports/agent-session-live-adapter-port";

const unexpectedEffectCall = (service: string, method: string) => () =>
  Effect.die(new Error(`Unexpected ${service} call: ${method}`));

const unexpectedSyncCall = (service: string, method: string): never => {
  throw new Error(`Unexpected ${service} call: ${method}`);
};

export const createAgentSessionRuntimeAdapterTestDouble = <
  Overrides extends Partial<Omit<AgentSessionRuntimeAdapterPort, "binding">>,
>(
  binding: AgentSessionLiveAdapterBinding,
  overrides: Overrides,
): AgentSessionRuntimeAdapterPort => ({
  queries: unexpectedRuntimeQueries,
  sessionImport: unexpectedSessionImport,
  textGeneration: unexpectedTextGeneration,
  supportsSessionControl: true,
  beginGeneratedImageBatch: unexpectedEffectCall("session adapter", "beginGeneratedImageBatch"),
  releaseGeneratedImageBatch: unexpectedEffectCall("session adapter", "releaseGeneratedImageBatch"),
  describeGeneratedImages: unexpectedEffectCall("session adapter", "describeGeneratedImages"),
  resolveGeneratedImageSource: unexpectedEffectCall(
    "session adapter",
    "resolveGeneratedImageSource",
  ),
  binding:
    binding instanceof AgentSessionLiveRegistration
      ? binding
      : new AgentSessionLiveRegistration(binding, (mutation) =>
          Effect.map(mutation, ({ value }) => value),
        ),
  continueInterruptedTurn: unexpectedEffectCall("live session adapter", "continueInterruptedTurn"),
  controlGoal: unexpectedEffectCall("live session adapter", "controlGoal"),
  forkSession: unexpectedEffectCall("live session adapter", "forkSession"),
  listSnapshots: unexpectedEffectCall("live session adapter", "listSnapshots"),
  loadContext: unexpectedEffectCall("live session adapter", "loadContext"),
  readSnapshot: unexpectedEffectCall("live session adapter", "readSnapshot"),
  releaseRuntime: unexpectedEffectCall("live session adapter", "releaseRuntime"),
  releaseSession: unexpectedEffectCall("live session adapter", "releaseSession"),
  resolvePendingApproval: unexpectedEffectCall("live session adapter", "resolvePendingApproval"),
  replyApproval: unexpectedEffectCall("live session adapter", "replyApproval"),
  replyQuestion: unexpectedEffectCall("live session adapter", "replyQuestion"),
  resumeSession: unexpectedEffectCall("live session adapter", "resumeSession"),
  sendUserMessage: unexpectedEffectCall("live session adapter", "sendUserMessage"),
  startSession: unexpectedEffectCall("live session adapter", "startSession"),
  stopSession: unexpectedEffectCall("live session adapter", "stopSession"),
  updateSessionModel: unexpectedEffectCall("live session adapter", "updateSessionModel"),
  updateSessionTitle: unexpectedEffectCall("live session adapter", "updateSessionTitle"),
  ...overrides,
});

export const createGitPortTestDouble = <Overrides extends Partial<GitPort>>(
  overrides: Overrides,
): GitPort => ({
  readPublicationTarget: unexpectedEffectCall("Git port", "readPublicationTarget"),
  inspectPublication: unexpectedEffectCall("Git port", "inspectPublication"),
  readCheckout: unexpectedEffectCall("Git port", "readCheckout"),
  abortConflict: unexpectedEffectCall("Git port", "abortConflict"),
  canonicalizePath: unexpectedEffectCall("Git port", "canonicalizePath"),
  changeSelection: unexpectedEffectCall("Git port", "changeSelection"),
  commitAll: unexpectedEffectCall("Git port", "commitAll"),
  commitStaged: unexpectedEffectCall("Git port", "commitStaged"),
  commitsAheadBehind: unexpectedEffectCall("Git port", "commitsAheadBehind"),
  configureBranchUpstream: unexpectedEffectCall("Git port", "configureBranchUpstream"),
  createWorktree: unexpectedEffectCall("Git port", "createWorktree"),
  deleteLocalBranch: unexpectedEffectCall("Git port", "deleteLocalBranch"),
  restoreDeletedBranch: unexpectedEffectCall("Git port", "restoreDeletedBranch"),
  deleteReference: unexpectedEffectCall("Git port", "deleteReference"),
  fetchRemote: unexpectedEffectCall("Git port", "fetchRemote"),
  listRefTips: unexpectedEffectCall("Git port", "listRefTips"),
  resolveFetchRemotes: unexpectedEffectCall("Git port", "resolveFetchRemotes"),
  countCommitsAhead: unexpectedEffectCall("Git port", "countCommitsAhead"),
  mergeTreeOids: unexpectedEffectCall("Git port", "mergeTreeOids"),
  readReflogs: unexpectedEffectCall("Git port", "readReflogs"),
  getTrackedUpstreamReference: unexpectedEffectCall("Git port", "getTrackedUpstreamReference"),
  getCurrentBranch: unexpectedEffectCall("Git port", "getCurrentBranch"),
  getDiff: unexpectedEffectCall("Git port", "getDiff"),
  getHistoryPage: unexpectedEffectCall("Git port", "getHistoryPage"),
  getLocalChanges: unexpectedEffectCall("Git port", "getLocalChanges"),
  getRepositoryRoot: unexpectedEffectCall("Git port", "getRepositoryRoot"),
  getStatus: unexpectedEffectCall("Git port", "getStatus"),
  getWorktreeStatusData: unexpectedEffectCall("Git port", "getWorktreeStatusData"),
  getWorktreeStatusSummaryData: unexpectedEffectCall("Git port", "getWorktreeStatusSummaryData"),
  isMergeIncluded: unexpectedEffectCall("Git port", "isMergeIncluded"),
  isAncestor: unexpectedEffectCall("Git port", "isAncestor"),
  isGitRepository: unexpectedEffectCall("Git port", "isGitRepository"),
  isRegisteredWorktree: unexpectedEffectCall("Git port", "isRegisteredWorktree"),
  listBranches: unexpectedEffectCall("Git port", "listBranches"),
  listChangedFiles: unexpectedEffectCall("Git port", "listChangedFiles"),
  getFileTreeContext: unexpectedEffectCall("Git port", "getFileTreeContext"),
  releaseReadCaptures: () => Effect.void,
  listFileRegions: unexpectedEffectCall("Git port", "listFileRegions"),
  listFiles: unexpectedEffectCall("Git port", "listFiles"),
  listRemotes: unexpectedEffectCall("Git port", "listRemotes"),
  readBranchRefs: unexpectedEffectCall("Git port", "readBranchRefs"),
  listRemoteEndpoints: unexpectedEffectCall("Git port", "listRemoteEndpoints"),
  listWorktrees: unexpectedEffectCall("Git port", "listWorktrees"),
  mergeBranch: unexpectedEffectCall("Git port", "mergeBranch"),
  pullBranch: unexpectedEffectCall("Git port", "pullBranch"),
  pushBranch: unexpectedEffectCall("Git port", "pushBranch"),
  pushBoundPublication: unexpectedEffectCall("Git port", "pushBoundPublication"),
  rebaseAbort: unexpectedEffectCall("Git port", "rebaseAbort"),
  rebaseBranch: unexpectedEffectCall("Git port", "rebaseBranch"),
  referenceExists: unexpectedEffectCall("Git port", "referenceExists"),
  removeWorktree: unexpectedEffectCall("Git port", "removeWorktree"),
  restoreWorktreeToReference: unexpectedEffectCall("Git port", "restoreWorktreeToReference"),
  suggestedSquashCommitMessage: unexpectedEffectCall("Git port", "suggestedSquashCommitMessage"),
  switchBranch: unexpectedEffectCall("Git port", "switchBranch"),
  ...overrides,
});

export const createSettingsConfigTestDouble = <Overrides extends Partial<SettingsConfigPort>>(
  overrides: Overrides,
): SettingsConfigPort =>
  withSettingsConfigMutationTestMethods({
    canonicalizePath: unexpectedEffectCall("settings config", "canonicalizePath"),
    defaultRepoWorktreeBasePath: () =>
      unexpectedSyncCall("settings config", "defaultRepoWorktreeBasePath"),
    defaultWorktreeBasePath: () => unexpectedSyncCall("settings config", "defaultWorktreeBasePath"),
    join: () => unexpectedSyncCall("settings config", "join"),
    pathExists: unexpectedEffectCall("settings config", "pathExists"),
    readConfig: unexpectedEffectCall("settings config", "readConfig"),
    resolveConfiguredPath: () => unexpectedSyncCall("settings config", "resolveConfiguredPath"),
    updateConfig: unexpectedEffectCall("settings config", "updateConfig"),
    ...overrides,
  });

export const createWorkspaceSettingsServiceTestDouble = <
  Overrides extends Partial<WorkspaceSettingsService>,
>(
  overrides: Overrides,
): WorkspaceSettingsService => ({
  listCustomAgentRoles: unexpectedEffectCall("workspace settings service", "listCustomAgentRoles"),
  createCustomAgentRole: unexpectedEffectCall(
    "workspace settings service",
    "createCustomAgentRole",
  ),
  updateCustomAgentRole: unexpectedEffectCall(
    "workspace settings service",
    "updateCustomAgentRole",
  ),
  deleteCustomAgentRole: unexpectedEffectCall(
    "workspace settings service",
    "deleteCustomAgentRole",
  ),
  addWorkspace: unexpectedEffectCall("workspace settings service", "addWorkspace"),
  beginWorkspaceRemoval: unexpectedEffectCall(
    "workspace settings service",
    "beginWorkspaceRemoval",
  ),
  closeWorkspace: unexpectedEffectCall("workspace settings service", "closeWorkspace"),
  getRepoConfig: unexpectedEffectCall("workspace settings service", "getRepoConfig"),
  getRepoConfigByRepoPath: unexpectedEffectCall(
    "workspace settings service",
    "getRepoConfigByRepoPath",
  ),
  getSettingsSnapshot: unexpectedEffectCall("workspace settings service", "getSettingsSnapshot"),
  getWorkspaceCatalog: unexpectedEffectCall("workspace settings service", "getWorkspaceCatalog"),
  listWorkspaces: unexpectedEffectCall("workspace settings service", "listWorkspaces"),
  recordWorkspaceRemovalProgress: unexpectedEffectCall(
    "workspace settings service",
    "recordWorkspaceRemovalProgress",
  ),
  removeWorkspaceRegistration: unexpectedEffectCall(
    "workspace settings service",
    "removeWorkspaceRegistration",
  ),
  reopenWorkspace: unexpectedEffectCall("workspace settings service", "reopenWorkspace"),
  reorderWorkspaces: unexpectedEffectCall("workspace settings service", "reorderWorkspaces"),
  replaceAgentStudioState: unexpectedEffectCall(
    "workspace settings service",
    "replaceAgentStudioState",
  ),
  applyAgentStudioStateAction: unexpectedEffectCall(
    "workspace settings service",
    "applyAgentStudioStateAction",
  ),
  resolveWorkspacePath: unexpectedEffectCall("workspace settings service", "resolveWorkspacePath"),
  saveSettingsSnapshotWith: unexpectedEffectCall(
    "workspace settings service",
    "saveSettingsSnapshotWith",
  ),
  prepareSettingsSnapshot: unexpectedEffectCall(
    "workspace settings service",
    "prepareSettingsSnapshot",
  ),
  selectWorkspace: unexpectedEffectCall("workspace settings service", "selectWorkspace"),
  setTheme: unexpectedEffectCall("workspace settings service", "setTheme"),
  updateAgentModelFavorites: unexpectedEffectCall(
    "workspace settings service",
    "updateAgentModelFavorites",
  ),
  updateKanbanTaskCardView: unexpectedEffectCall(
    "workspace settings service",
    "updateKanbanTaskCardView",
  ),
  updateSidebarSessionGrouping: unexpectedEffectCall(
    "workspace settings service",
    "updateSidebarSessionGrouping",
  ),
  updateRepoGitConfig: unexpectedEffectCall("workspace settings service", "updateRepoGitConfig"),
  readRemoteAccessSettings: unexpectedEffectCall(
    "workspace settings service",
    "readRemoteAccessSettings",
  ),
  saveRemoteAccessSettings: unexpectedEffectCall(
    "workspace settings service",
    "saveRemoteAccessSettings",
  ),
  ...overrides,
});

export const createWorktreeFilePortTestDouble = <Overrides extends Partial<WorktreeFilePort>>(
  overrides: Overrides,
): WorktreeFilePort => ({
  copyConfiguredPaths: unexpectedEffectCall("worktree file port", "copyConfiguredPaths"),
  ensureDirectory: unexpectedEffectCall("worktree file port", "ensureDirectory"),
  pathIsWithinRoot: unexpectedEffectCall("worktree file port", "pathIsWithinRoot"),
  resolveWorktreeRemovalPath: unexpectedEffectCall(
    "worktree file port",
    "resolveWorktreeRemovalPath",
  ),
  prepareWorktreeAliasRemoval: unexpectedEffectCall(
    "worktree file port",
    "prepareWorktreeAliasRemoval",
  ),
  removePathIfPresent: unexpectedEffectCall("worktree file port", "removePathIfPresent"),
  resolvePathWithinRoot: unexpectedEffectCall("worktree file port", "resolvePathWithinRoot"),
  resolveWorktreePath: () => unexpectedSyncCall("worktree file port", "resolveWorktreePath"),
  ...overrides,
});

/** No other owner needs a task worktree, so task cleanup can remove every task worktree. */
export const noWorktreeOwners: TaskWorktreeOwnerReader = {
  readOwners: () => Effect.succeed({ owners: emptyWorktreeOwners(), historyReadErrors: [] }),
};

/**
 * A Claude metadata port. `read` answers the history directory of each session. Without it, a
 * read fails the test.
 */
export const createClaudeSessionMetadataTestDouble = (
  read?: (externalSessionId: string) => Effect.Effect<string | null, HostOperationError>,
): ClaudeSessionMetadataPort => ({
  readWorkingDirectories: read
    ? (externalSessionIds) =>
        Effect.forEach(externalSessionIds, (id) =>
          read(id).pipe(
            Effect.map((directory): ClaudeWorkingDirectoryRead => ({ kind: "read", directory })),
            Effect.catch((error) =>
              Effect.succeed<ClaudeWorkingDirectoryRead>({ kind: "failed", error }),
            ),
            Effect.map((entry) => [id, entry] as const),
          ),
        ).pipe(Effect.map((entries) => new Map(entries)))
    : unexpectedEffectCall("Claude session metadata", "readWorkingDirectories"),
});

/** Goal rules that allow every goal command, for tests that do not check runtime versions. */
export const allowAllGoalCommands = {
  blockedReason: () => Effect.succeed(null),
} satisfies Pick<
  import("../application/agent-sessions/session-goal-rules").SessionGoalRules,
  "blockedReason"
>;
