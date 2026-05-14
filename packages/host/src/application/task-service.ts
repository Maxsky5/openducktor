import {
  type AgentSessionRecord,
  agentSessionRecordSchema,
  type BuildSessionBootstrap,
  buildSessionBootstrapSchema,
  DEFAULT_BRANCH_PREFIX,
  type DirectMergeRecord,
  type GitConflict,
  type GitMergeMethod,
  type GitProviderAvailability,
  type GitProviderRepository,
  type GitTargetBranch,
  globalConfigSchema,
  type PlanSubtaskInput,
  type PullRequest,
  planSubtaskInputSchema,
  pullRequestSchema,
  type QaReportVerdict,
  type RepoConfig,
  type TaskApprovalContext,
  type TaskApprovalContextLoadResult,
  type TaskCard,
  type TaskCreateInput,
  type TaskDirectMergeResult,
  type TaskMetadataDocument,
  type TaskMetadataPayload,
  type TaskPullRequestDetectResult,
  type TaskStatus,
  type TaskUpdatePatch,
  taskCreateInputSchema,
  taskDirectMergeInputSchema,
  taskStatusSchema,
  taskUpdatePatchSchema,
} from "@openducktor/contracts";
import type { GitPort } from "../ports/git-port";
import type { RuntimeRegistryPort } from "../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../ports/settings-config-port";
import type { SystemCommandPort, SystemCommandRunResult } from "../ports/system-command-port";
import type { TaskActivityGuardPort } from "../ports/task-activity-guard-port";
import type { TaskStorePort } from "../ports/task-store-port";
import type { WorktreeFilePort } from "../ports/worktree-file-port";
import type { DevServerService } from "./dev-server-service";
import { parseGithubRemoteUrl } from "./github-repository-detection-service";
import type { RuntimeDefinitionsService } from "./runtime-definitions-service";
import {
  canReplaceEpicSubtaskStatus,
  canResetImplementationFromStatus,
  canResetTaskFromStatus,
  canSetPlan,
  canSetSpecFromStatus,
  deriveAgentWorkflows,
  deriveAvailableActions,
  isActiveOrReviewStatus,
  isDeferrableOpenState,
  validateTransition,
} from "./task-workflow-rules";
import type { TaskWorktreeService } from "./task-worktree-service";
import type { WorkspaceSettingsService } from "./workspace-settings-service";

export type TaskService = {
  listTasks(input: unknown): Promise<TaskCard[]>;
  getTaskMetadata(input: unknown): Promise<TaskMetadataPayload>;
  agentSessionsList(input: unknown): Promise<AgentSessionRecord[]>;
  agentSessionsListBulk(input: unknown): Promise<Record<string, AgentSessionRecord[]>>;
  agentSessionUpsert(input: unknown): Promise<boolean>;
  getApprovalContext(input: unknown): Promise<TaskApprovalContextLoadResult>;
  detectPullRequest(input: unknown): Promise<TaskPullRequestDetectResult>;
  linkPullRequest(input: unknown): Promise<PullRequest>;
  upsertPullRequest(input: unknown): Promise<PullRequest>;
  unlinkPullRequest(input: unknown): Promise<boolean>;
  linkMergedPullRequest(input: unknown): Promise<TaskCard>;
  directMerge(input: unknown): Promise<TaskDirectMergeResult>;
  completeDirectMerge(input: unknown): Promise<TaskCard>;
  createTask(input: unknown): Promise<TaskCard>;
  deleteTask(input: unknown): Promise<{ ok: boolean }>;
  resetImplementation(input: unknown): Promise<TaskCard>;
  resetTask(input: unknown): Promise<TaskCard>;
  updateTask(input: unknown): Promise<TaskCard>;
  transitionTask(input: unknown): Promise<TaskCard>;
  specGet(input: unknown): Promise<TaskMetadataDocument>;
  setSpec(input: unknown): Promise<TaskMetadataDocument>;
  saveSpecDocument(input: unknown): Promise<TaskMetadataDocument>;
  planGet(input: unknown): Promise<TaskMetadataDocument>;
  setPlan(input: unknown): Promise<TaskMetadataDocument>;
  savePlanDocument(input: unknown): Promise<TaskMetadataDocument>;
  qaGetReport(input: unknown): Promise<TaskMetadataDocument>;
  buildBlocked(input: unknown): Promise<TaskCard>;
  buildStart(input: unknown): Promise<BuildSessionBootstrap>;
  buildResumed(input: unknown): Promise<TaskCard>;
  buildCompleted(input: unknown): Promise<TaskCard>;
  qaApproved(input: unknown): Promise<TaskCard>;
  qaRejected(input: unknown): Promise<TaskCard>;
  humanRequestChanges(input: unknown): Promise<TaskCard>;
  humanApprove(input: unknown): Promise<TaskCard>;
  repoPullRequestSync(input: unknown): Promise<{ ok: boolean }>;
  repoPullRequestSyncDetailed(input: unknown): Promise<RepoPullRequestSyncResult>;
  deferTask(input: unknown): Promise<TaskCard>;
  resumeDeferredTask(input: unknown): Promise<TaskCard>;
};

export type RepoPullRequestSyncResult = {
  ran: boolean;
  changedTaskIds: string[];
};

export type CreateTaskServiceInput = {
  devServerService?: DevServerService;
  gitPort?: GitPort;
  taskStore: TaskStorePort;
  taskActivityGuard?: TaskActivityGuardPort;
  settingsConfig?: SettingsConfigPort;
  systemCommands?: SystemCommandPort;
  taskWorktreeService?: TaskWorktreeService;
  workspaceSettingsService?: WorkspaceSettingsService;
  runtimeDefinitionsService?: RuntimeDefinitionsService;
  runtimeRegistry?: RuntimeRegistryPort;
  worktreeFiles?: WorktreeFilePort;
};

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
};

const requireString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
};

const optionalNonNegativeInteger = (value: unknown, label: string): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw new Error(`${label} must be greater than or equal to 0.`);
  }

  return value;
};

const requirePositiveInteger = (value: unknown, label: string): number => {
  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
};

const enrichTasks = (tasks: TaskCard[]): TaskCard[] =>
  tasks.map((task) => ({
    ...task,
    availableActions: deriveAvailableActions(task, tasks),
    agentWorkflows: deriveAgentWorkflows(task),
  }));

const enrichTask = (task: TaskCard, allTasks: TaskCard[]): TaskCard => ({
  ...task,
  availableActions: deriveAvailableActions(task, allTasks),
  agentWorkflows: deriveAgentWorkflows(task),
});

const parseCreateInput = (value: unknown): TaskCreateInput => {
  const parsed = taskCreateInputSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(`task_create input.input is invalid: ${parsed.error.message}`);
};

const parseUpdatePatch = (value: unknown): TaskUpdatePatch => {
  const parsed = taskUpdatePatchSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(`task_update input.patch is invalid: ${parsed.error.message}`);
};

const parseTransitionStatus = (value: unknown) => {
  const parsed = taskStatusSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(`task_transition input.status is invalid: ${parsed.error.message}`);
};

const optionalBoolean = (value: unknown, label: string): boolean | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean when provided.`);
  }

  return value;
};

const parseRequiredMarkdown = (value: unknown, label: string): string => {
  if (typeof value !== "string") {
    throw new Error(`${label} markdown cannot be empty.`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} markdown cannot be empty.`);
  }

  return trimmed;
};

const parseOptionalNote = (value: unknown, label: string): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string when present.`);
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const parsePlanSubtasks = (value: unknown): PlanSubtaskInput[] => {
  if (value === undefined) {
    return [];
  }

  const parsed = planSubtaskInputSchema.array().safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(`set_plan input.input.subtasks is invalid: ${parsed.error.message}`);
};

const parseTaskIdList = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value.map((entry, index) => requireString(entry, `${label}[${index}]`));
};

const normalizeAgentSessionInput = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  return {
    ...record,
    externalSessionId:
      typeof record.externalSessionId === "string"
        ? record.externalSessionId.trim()
        : record.externalSessionId,
    role: typeof record.role === "string" ? record.role.trim() : record.role,
    startedAt: typeof record.startedAt === "string" ? record.startedAt.trim() : record.startedAt,
    runtimeKind:
      typeof record.runtimeKind === "string" ? record.runtimeKind.trim() : record.runtimeKind,
    workingDirectory:
      typeof record.workingDirectory === "string"
        ? record.workingDirectory.trim()
        : record.workingDirectory,
  };
};

const parseAgentSessionRecord = (value: unknown): AgentSessionRecord => {
  const parsed = agentSessionRecordSchema.safeParse(normalizeAgentSessionInput(value));
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(`agent_session_upsert input.session is invalid: ${parsed.error.message}`);
};

const parsePullRequest = (value: unknown): PullRequest => {
  const parsed = pullRequestSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(
    `task_pull_request_link_merged input.pullRequest is invalid: ${parsed.error.message}`,
  );
};

const parsePullRequestContent = (value: unknown): { title: string; body: string } => {
  const record = requireRecord(value, "task_pull_request_upsert input.input");
  const title = requireString(record.title, "input.title");
  if (typeof record.body !== "string") {
    throw new Error("input.body is required.");
  }

  return { title, body: record.body };
};

const parseTaskDirectMergeInput = (value: unknown) => {
  const parsed = taskDirectMergeInputSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(`task_direct_merge input.input is invalid: ${parsed.error.message}`);
};

const compactAgentSessionForStorage = (session: AgentSessionRecord): AgentSessionRecord => {
  const role = session.role.trim();
  if (!role) {
    throw new Error("Agent session role is required");
  }

  const externalSessionId = session.externalSessionId.trim();
  if (!externalSessionId) {
    throw new Error("Agent session externalSessionId is required");
  }

  const startedAt = session.startedAt.trim();
  if (!startedAt) {
    throw new Error("Agent session startedAt is required");
  }

  const runtimeKind = session.runtimeKind.trim();
  if (!runtimeKind) {
    throw new Error("Agent session runtimeKind is required");
  }

  const workingDirectory = session.workingDirectory.trim();
  if (!workingDirectory) {
    throw new Error("Agent session workingDirectory is required");
  }

  if (session.selectedModel !== null && !session.selectedModel.runtimeKind.trim()) {
    throw new Error("Agent session selectedModel.runtimeKind is required");
  }

  return agentSessionRecordSchema.parse({
    ...session,
    externalSessionId,
    role,
    startedAt,
    runtimeKind,
    workingDirectory,
    selectedModel:
      session.selectedModel === null
        ? null
        : {
            ...session.selectedModel,
            runtimeKind: session.selectedModel.runtimeKind.trim(),
          },
  });
};

const requireAgentSessionDependencies = (
  taskStore: TaskStorePort,
  settingsConfig: SettingsConfigPort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  upsertAgentSession: NonNullable<TaskStorePort["upsertAgentSession"]>;
  settingsConfig: SettingsConfigPort;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!taskStore.upsertAgentSession) {
    throw new Error("Task store port is required to support agent_session_upsert.");
  }
  if (!settingsConfig) {
    throw new Error("Settings config port is required for agent_session_upsert.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for agent_session_upsert.");
  }

  return {
    upsertAgentSession: taskStore.upsertAgentSession.bind(taskStore),
    settingsConfig,
    workspaceSettingsService,
  };
};

const requireBuildCompletedDependencies = (
  settingsConfig: SettingsConfigPort | undefined,
  systemCommands: SystemCommandPort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  settingsConfig: SettingsConfigPort;
  systemCommands: SystemCommandPort;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!settingsConfig) {
    throw new Error("Settings config port is required for build_completed.");
  }
  if (!systemCommands) {
    throw new Error("System command port is required for build_completed.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for build_completed.");
  }

  return { settingsConfig, systemCommands, workspaceSettingsService };
};

const requireBuildStartDependencies = (
  gitPort: GitPort | undefined,
  runtimeDefinitionsService: RuntimeDefinitionsService | undefined,
  runtimeRegistry: RuntimeRegistryPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  systemCommands: SystemCommandPort | undefined,
  worktreeFiles: WorktreeFilePort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  gitPort: GitPort & {
    configureBranchUpstream: NonNullable<GitPort["configureBranchUpstream"]>;
    deleteReference: NonNullable<GitPort["deleteReference"]>;
    referenceExists: NonNullable<GitPort["referenceExists"]>;
  };
  runtimeDefinitionsService: RuntimeDefinitionsService;
  runtimeRegistry: RuntimeRegistryPort;
  settingsConfig: SettingsConfigPort;
  systemCommands: SystemCommandPort;
  worktreeFiles: WorktreeFilePort & {
    ensureDirectory: NonNullable<WorktreeFilePort["ensureDirectory"]>;
  };
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!gitPort) {
    throw new Error("Git port is required for build_start.");
  }
  if (!gitPort.referenceExists) {
    throw new Error("Git port is required to support build_start reference checks.");
  }
  if (!gitPort.configureBranchUpstream) {
    throw new Error("Git port is required to support build_start upstream setup.");
  }
  if (!gitPort.deleteReference) {
    throw new Error("Git port is required to support build_start upstream cleanup.");
  }
  if (!runtimeDefinitionsService) {
    throw new Error("Runtime definitions service is required for build_start.");
  }
  if (!runtimeRegistry) {
    throw new Error("Runtime registry port is required for build_start.");
  }
  if (!settingsConfig) {
    throw new Error("Settings config port is required for build_start.");
  }
  if (!systemCommands) {
    throw new Error("System command port is required for build_start.");
  }
  if (!worktreeFiles) {
    throw new Error("Worktree file port is required for build_start.");
  }
  if (!worktreeFiles.ensureDirectory) {
    throw new Error("Worktree file port is required to support build_start directory creation.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for build_start.");
  }

  return {
    gitPort: gitPort as GitPort & {
      configureBranchUpstream: NonNullable<GitPort["configureBranchUpstream"]>;
      deleteReference: NonNullable<GitPort["deleteReference"]>;
      referenceExists: NonNullable<GitPort["referenceExists"]>;
    },
    runtimeDefinitionsService,
    runtimeRegistry,
    settingsConfig,
    systemCommands,
    worktreeFiles: worktreeFiles as WorktreeFilePort & {
      ensureDirectory: NonNullable<WorktreeFilePort["ensureDirectory"]>;
    },
    workspaceSettingsService,
  };
};

const requireDirectMergeCompleteDependencies = (
  devServerService: DevServerService | undefined,
  gitPort: GitPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  taskWorktreeService: TaskWorktreeService | undefined,
): {
  devServerService: DevServerService;
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  taskWorktreeService: TaskWorktreeService;
} => {
  if (!devServerService) {
    throw new Error("Dev server service is required for task_direct_merge_complete.");
  }
  if (!gitPort) {
    throw new Error("Git port is required for task_direct_merge_complete.");
  }
  if (!settingsConfig) {
    throw new Error("Settings config port is required for task_direct_merge_complete.");
  }
  if (!taskWorktreeService) {
    throw new Error("Task worktree service is required for task_direct_merge_complete.");
  }

  return { devServerService, gitPort, settingsConfig, taskWorktreeService };
};

const requireDirectMergeDependencies = (
  devServerService: DevServerService | undefined,
  gitPort: GitPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  systemCommands: SystemCommandPort | undefined,
  taskWorktreeService: TaskWorktreeService | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  devServerService: DevServerService;
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  systemCommands: SystemCommandPort;
  taskWorktreeService: TaskWorktreeService;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!devServerService) {
    throw new Error("Dev server service is required for task_direct_merge.");
  }
  if (!gitPort) {
    throw new Error("Git port is required for task_direct_merge.");
  }
  if (!settingsConfig) {
    throw new Error("Settings config port is required for task_direct_merge.");
  }
  if (!systemCommands) {
    throw new Error("System command port is required for task_direct_merge.");
  }
  if (!taskWorktreeService) {
    throw new Error("Task worktree service is required for task_direct_merge.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for task_direct_merge.");
  }

  return {
    devServerService,
    gitPort,
    settingsConfig,
    systemCommands,
    taskWorktreeService,
    workspaceSettingsService,
  };
};

const requireLinkMergedPullRequestDependencies = (
  devServerService: DevServerService | undefined,
  gitPort: GitPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  taskWorktreeService: TaskWorktreeService | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  devServerService: DevServerService;
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  taskWorktreeService: TaskWorktreeService;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!devServerService) {
    throw new Error("Dev server service is required for task_pull_request_link_merged.");
  }
  if (!gitPort) {
    throw new Error("Git port is required for task_pull_request_link_merged.");
  }
  if (!settingsConfig) {
    throw new Error("Settings config port is required for task_pull_request_link_merged.");
  }
  if (!taskWorktreeService) {
    throw new Error("Task worktree service is required for task_pull_request_link_merged.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for task_pull_request_link_merged.");
  }

  return {
    devServerService,
    gitPort,
    settingsConfig,
    taskWorktreeService,
    workspaceSettingsService,
  };
};

const requireApprovalContextDependencies = (
  gitPort: GitPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  systemCommands: SystemCommandPort | undefined,
  taskWorktreeService: TaskWorktreeService | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  systemCommands: SystemCommandPort;
  taskWorktreeService: TaskWorktreeService;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!gitPort) {
    throw new Error("Git port is required for task_approval_context_get.");
  }
  if (!settingsConfig) {
    throw new Error("Settings config port is required for task_approval_context_get.");
  }
  if (!systemCommands) {
    throw new Error("System command port is required for task_approval_context_get.");
  }
  if (!taskWorktreeService) {
    throw new Error("Task worktree service is required for task_approval_context_get.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for task_approval_context_get.");
  }

  return {
    gitPort,
    settingsConfig,
    systemCommands,
    taskWorktreeService,
    workspaceSettingsService,
  };
};

const requirePullRequestDetectionDependencies = (
  gitPort: GitPort | undefined,
  systemCommands: SystemCommandPort | undefined,
  taskWorktreeService: TaskWorktreeService | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  gitPort: GitPort;
  systemCommands: SystemCommandPort;
  taskWorktreeService: TaskWorktreeService;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!gitPort) {
    throw new Error("Git port is required for task_pull_request_detect.");
  }
  if (!systemCommands) {
    throw new Error("System command port is required for task_pull_request_detect.");
  }
  if (!taskWorktreeService) {
    throw new Error("Task worktree service is required for task_pull_request_detect.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for task_pull_request_detect.");
  }

  return {
    gitPort,
    systemCommands,
    taskWorktreeService,
    workspaceSettingsService,
  };
};

const requirePullRequestLinkDependencies = (
  gitPort: GitPort | undefined,
  systemCommands: SystemCommandPort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  gitPort: GitPort;
  systemCommands: SystemCommandPort;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!gitPort) {
    throw new Error("Git port is required for task_pull_request_link.");
  }
  if (!systemCommands) {
    throw new Error("System command port is required for task_pull_request_link.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for task_pull_request_link.");
  }

  return {
    gitPort,
    systemCommands,
    workspaceSettingsService,
  };
};

const requirePullRequestUpsertDependencies = (
  gitPort: GitPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  systemCommands: SystemCommandPort | undefined,
  taskWorktreeService: TaskWorktreeService | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  systemCommands: SystemCommandPort;
  taskWorktreeService: TaskWorktreeService;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!gitPort) {
    throw new Error("Git port is required for task_pull_request_upsert.");
  }
  if (!settingsConfig) {
    throw new Error("Settings config port is required for task_pull_request_upsert.");
  }
  if (!systemCommands) {
    throw new Error("System command port is required for task_pull_request_upsert.");
  }
  if (!taskWorktreeService) {
    throw new Error("Task worktree service is required for task_pull_request_upsert.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for task_pull_request_upsert.");
  }

  return {
    gitPort,
    settingsConfig,
    systemCommands,
    taskWorktreeService,
    workspaceSettingsService,
  };
};

const requirePullRequestSyncDependencies = (
  systemCommands: SystemCommandPort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  systemCommands: SystemCommandPort;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!systemCommands) {
    throw new Error("System command port is required for repo_pull_request_sync.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for repo_pull_request_sync.");
  }

  return { systemCommands, workspaceSettingsService };
};

const requirePullRequestMergeCleanupDependencies = (
  devServerService: DevServerService | undefined,
  gitPort: GitPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  taskWorktreeService: TaskWorktreeService | undefined,
): {
  devServerService: DevServerService;
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  taskWorktreeService: TaskWorktreeService;
} => {
  if (!devServerService) {
    throw new Error("Dev server service is required for repo_pull_request_sync.");
  }
  if (!gitPort) {
    throw new Error("Git port is required for repo_pull_request_sync.");
  }
  if (!settingsConfig) {
    throw new Error("Settings config port is required for repo_pull_request_sync.");
  }
  if (!taskWorktreeService) {
    throw new Error("Task worktree service is required for repo_pull_request_sync.");
  }

  return { devServerService, gitPort, settingsConfig, taskWorktreeService };
};

const requireTaskDeleteDependencies = (
  devServerService: DevServerService | undefined,
  gitPort: GitPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): {
  devServerService: DevServerService;
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  workspaceSettingsService: WorkspaceSettingsService;
} => {
  if (!devServerService) {
    throw new Error("Dev server service is required for task_delete.");
  }
  if (!gitPort) {
    throw new Error("Git port is required for task_delete.");
  }
  if (!settingsConfig) {
    throw new Error("Settings config port is required for task_delete.");
  }
  if (!workspaceSettingsService) {
    throw new Error("Workspace settings service is required for task_delete.");
  }

  return { devServerService, gitPort, settingsConfig, workspaceSettingsService };
};

const requireImplementationResetStoreDependencies = (
  taskStore: TaskStorePort,
): {
  clearAgentSessionsByRoles: NonNullable<TaskStorePort["clearAgentSessionsByRoles"]>;
  clearQaReports: NonNullable<TaskStorePort["clearQaReports"]>;
  setDirectMerge: NonNullable<TaskStorePort["setDirectMerge"]>;
  setPullRequest: NonNullable<TaskStorePort["setPullRequest"]>;
} => {
  if (!taskStore.clearAgentSessionsByRoles) {
    throw new Error("Task store port is required to support task_reset_implementation sessions.");
  }
  if (!taskStore.clearQaReports) {
    throw new Error("Task store port is required to support task_reset_implementation QA cleanup.");
  }
  if (!taskStore.setPullRequest || !taskStore.setDirectMerge) {
    throw new Error(
      "Task store port is required to support task_reset_implementation delivery cleanup.",
    );
  }

  return {
    clearAgentSessionsByRoles: taskStore.clearAgentSessionsByRoles.bind(taskStore),
    clearQaReports: taskStore.clearQaReports.bind(taskStore),
    setDirectMerge: taskStore.setDirectMerge.bind(taskStore),
    setPullRequest: taskStore.setPullRequest.bind(taskStore),
  };
};

const requireTaskResetStoreDependencies = (
  taskStore: TaskStorePort,
): {
  clearAgentSessionsByRoles: NonNullable<TaskStorePort["clearAgentSessionsByRoles"]>;
  clearWorkflowDocuments: NonNullable<TaskStorePort["clearWorkflowDocuments"]>;
  setDirectMerge: NonNullable<TaskStorePort["setDirectMerge"]>;
  setPullRequest: NonNullable<TaskStorePort["setPullRequest"]>;
} => {
  if (!taskStore.clearAgentSessionsByRoles) {
    throw new Error("Task store port is required to support task_reset sessions.");
  }
  if (!taskStore.clearWorkflowDocuments) {
    throw new Error("Task store port is required to support task_reset document cleanup.");
  }
  if (!taskStore.setPullRequest || !taskStore.setDirectMerge) {
    throw new Error("Task store port is required to support task_reset delivery cleanup.");
  }

  return {
    clearAgentSessionsByRoles: taskStore.clearAgentSessionsByRoles.bind(taskStore),
    clearWorkflowDocuments: taskStore.clearWorkflowDocuments.bind(taskStore),
    setDirectMerge: taskStore.setDirectMerge.bind(taskStore),
    setPullRequest: taskStore.setPullRequest.bind(taskStore),
  };
};

const normalizeComparablePath = (value: string): string =>
  value.replace(/\\/g, "/").replace(/\/+$/g, "");

const pathStartsWith = (child: string, parent: string): boolean => {
  const normalizedChild = normalizeComparablePath(child);
  const normalizedParent = normalizeComparablePath(parent);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
};

const tryCanonicalizePath = async (
  settingsConfig: SettingsConfigPort,
  rawPath: string | null | undefined,
): Promise<string | undefined> => {
  const trimmed = rawPath?.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return await settingsConfig.canonicalizePath(trimmed);
  } catch {
    return undefined;
  }
};

const canonicalizeRequiredPath = async (
  settingsConfig: SettingsConfigPort,
  rawPath: string,
  errorMessage: string,
): Promise<string> => {
  const trimmed = rawPath.trim();
  try {
    return await settingsConfig.canonicalizePath(trimmed);
  } catch (error) {
    throw new Error(`${errorMessage}: ${trimmed}`, { cause: error });
  }
};

const validateAgentSessionWorkingDirectory = async (
  settingsConfig: SettingsConfigPort,
  workspaceSettingsService: WorkspaceSettingsService,
  repoPath: string,
  session: AgentSessionRecord,
): Promise<void> => {
  const canonicalRepoPath = await canonicalizeRequiredPath(
    settingsConfig,
    repoPath,
    "Repository path for agent session validation must exist and be accessible",
  );
  const canonicalWorkingDirectory = await canonicalizeRequiredPath(
    settingsConfig,
    session.workingDirectory,
    "Agent session workingDirectory must exist and be accessible",
  );

  if (pathStartsWith(canonicalWorkingDirectory, canonicalRepoPath)) {
    return;
  }

  const workspaces = await workspaceSettingsService.listWorkspaces();
  const workspace = workspaces.find((entry) => entry.repoPath === canonicalRepoPath);
  const canonicalEffectiveWorktreeBase = await tryCanonicalizePath(
    settingsConfig,
    workspace?.effectiveWorktreeBasePath ?? null,
  );
  if (
    canonicalEffectiveWorktreeBase &&
    pathStartsWith(canonicalWorkingDirectory, canonicalEffectiveWorktreeBase)
  ) {
    return;
  }

  const canonicalLegacyWorktreeBase = await tryCanonicalizePath(
    settingsConfig,
    settingsConfig.defaultRepoWorktreeBasePath(canonicalRepoPath),
  );
  if (
    canonicalLegacyWorktreeBase &&
    pathStartsWith(canonicalWorkingDirectory, canonicalLegacyWorktreeBase)
  ) {
    return;
  }

  throw new Error(
    `Agent session workingDirectory must stay inside repository ${repoPath} or its effective worktree base. Received: ${session.workingDirectory}`,
  );
};

const ensurePullRequestManagementStatus = (status: TaskCard["status"]): void => {
  if (status === "in_progress" || status === "ai_review" || status === "human_review") {
    return;
  }

  throw new Error(
    "Pull request management is only available from in_progress, ai_review, or human_review.",
  );
};

const ensureHumanApprovalStatus = (status: TaskCard["status"]): void => {
  if (status === "ai_review" || status === "human_review") {
    return;
  }

  throw new Error("Human approval is only allowed from ai_review or human_review.");
};

const normalizeApprovalTargetBranch = (targetBranch: GitTargetBranch): GitTargetBranch => {
  const remote = targetBranch.remote?.trim();
  const branch = targetBranch.branch.trim();
  if (!branch) {
    throw new Error("Human approval requires a target branch.");
  }
  if (branch === "@{upstream}") {
    throw new Error(
      "Human approval requires an explicit target branch. '@{upstream}' is not supported for direct merge or pull requests.",
    );
  }

  return remote ? { remote, branch } : { branch };
};

const publishTargetFromTargetBranch = (
  targetBranch: GitTargetBranch,
): GitTargetBranch | undefined => {
  const normalized = normalizeApprovalTargetBranch(targetBranch);
  return normalized.remote ? normalized : undefined;
};

const loadDefaultMergeMethod = async (
  settingsConfig: SettingsConfigPort,
): Promise<ReturnType<typeof globalConfigSchema.parse>["git"]["defaultMergeMethod"]> => {
  const payload = await settingsConfig.readConfig();
  const config = globalConfigSchema.parse(payload ?? { version: 2 });
  return config.git.defaultMergeMethod;
};

const GITHUB_PROVIDER_ID = "github";
const GH_NON_INTERACTIVE_ENV = { GH_PROMPT_DISABLED: "1" };

const repositoryKey = (repository: { host: string; owner: string; name: string }): string =>
  `${repository.host}/${repository.owner}/${repository.name}`.toLowerCase();

const combinedCommandOutput = (stdout: string, stderr: string): string => {
  const trimmedStdout = stdout.trim();
  const trimmedStderr = stderr.trim();
  if (!trimmedStdout) {
    return trimmedStderr;
  }
  if (!trimmedStderr) {
    return trimmedStdout;
  }
  return `${trimmedStdout}\n${trimmedStderr}`;
};

const githubProviderStatus = async (
  dependencies: {
    gitPort: GitPort;
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  repoConfig: RepoConfig,
): Promise<GitProviderAvailability> => {
  const providerConfig = repoConfig.git.providers[GITHUB_PROVIDER_ID];
  if (!providerConfig?.enabled) {
    return {
      providerId: GITHUB_PROVIDER_ID,
      enabled: false,
      available: false,
      reason: "GitHub provider is not enabled for this repository.",
    };
  }

  const ghError = await dependencies.systemCommands.requiredCommandError("gh");
  if (ghError !== null) {
    return {
      providerId: GITHUB_PROVIDER_ID,
      enabled: true,
      available: false,
      reason: "gh CLI is not installed.",
    };
  }

  const repository = providerConfig.repository;
  if (!repository) {
    return {
      providerId: GITHUB_PROVIDER_ID,
      enabled: true,
      available: false,
      reason: "GitHub repository coordinates are missing.",
    };
  }

  let authStatus: SystemCommandRunResult;
  try {
    authStatus = await dependencies.systemCommands.runCommandAllowFailure(
      "gh",
      ["auth", "status", "--hostname", repository.host],
      { env: GH_NON_INTERACTIVE_ENV },
    );
  } catch (error) {
    return {
      providerId: GITHUB_PROVIDER_ID,
      enabled: true,
      available: false,
      reason: `Failed to check GitHub authentication: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  if (!authStatus.ok) {
    const output = combinedCommandOutput(authStatus.stdout, authStatus.stderr);
    return {
      providerId: GITHUB_PROVIDER_ID,
      enabled: true,
      available: false,
      reason:
        output.length > 0
          ? output
          : "GitHub authentication is not configured. Run `gh auth login`.",
    };
  }

  const expectedKey = repositoryKey(repository);
  const hasMatchingRemote = (await dependencies.gitPort.listRemotes(repoPath)).some((remote) => {
    const parsed = parseGithubRemoteUrl(remote.url);
    return parsed !== null && repositoryKey(parsed) === expectedKey;
  });
  if (!hasMatchingRemote) {
    return {
      providerId: GITHUB_PROVIDER_ID,
      enabled: true,
      available: false,
      reason: `No matching Git remote is configured for ${repository.owner}/${repository.name} on ${repository.host}.`,
    };
  }

  return {
    providerId: GITHUB_PROVIDER_ID,
    enabled: true,
    available: true,
  };
};

type GithubPullBranchRef = {
  ref?: unknown;
};

type GithubPullResponse = {
  number?: unknown;
  html_url?: unknown;
  draft?: unknown;
  state?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  merged_at?: unknown;
  closed_at?: unknown;
  head?: GithubPullBranchRef;
  base?: GithubPullBranchRef;
};

type ResolvedPullRequest = {
  record: PullRequest;
  sourceBranch: string;
  targetBranch: string;
};

type GithubPullRequestContext = {
  repository: GitProviderRepository;
  remoteName: string;
};

const requireGithubString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`GitHub pull request response field ${label} is missing or invalid.`);
  }
  return value;
};

const requireGithubNumber = (value: unknown, label: string): number => {
  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    throw new Error(`GitHub pull request response field ${label} is missing or invalid.`);
  }
  return value;
};

const normalizeGithubPullRequest = (response: GithubPullResponse): ResolvedPullRequest => {
  const mergedAt = typeof response.merged_at === "string" ? response.merged_at : undefined;
  const closedAt = typeof response.closed_at === "string" ? response.closed_at : undefined;
  const rawState = requireGithubString(response.state, "state").trim().toLowerCase();
  const state =
    mergedAt !== undefined
      ? "merged"
      : response.draft === true
        ? "draft"
        : rawState === "open"
          ? "open"
          : "closed_unmerged";

  return {
    record: pullRequestSchema.parse({
      providerId: GITHUB_PROVIDER_ID,
      number: requireGithubNumber(response.number, "number"),
      url: requireGithubString(response.html_url, "html_url"),
      state,
      createdAt: requireGithubString(response.created_at, "created_at"),
      updatedAt: requireGithubString(response.updated_at, "updated_at"),
      lastSyncedAt: new Date().toISOString(),
      mergedAt,
      closedAt,
    }),
    sourceBranch: requireGithubString(response.head?.ref, "head.ref"),
    targetBranch: requireGithubString(response.base?.ref, "base.ref"),
  };
};

const parseGithubPullListResponse = (payload: string): ResolvedPullRequest[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new Error(
      `Failed to parse GitHub pull request list response: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const responses = Array.isArray(parsed) ? parsed : undefined;
  if (!responses) {
    throw new Error("Failed to parse GitHub pull request list response: expected an array.");
  }
  const flattened = responses.every((entry) => Array.isArray(entry)) ? responses.flat() : responses;
  return flattened.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Failed to parse GitHub pull request list response: expected objects.");
    }
    return normalizeGithubPullRequest(entry as GithubPullResponse);
  });
};

const parseGithubPullResponse = (payload: string): ResolvedPullRequest => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new Error(
      `Failed to parse GitHub pull request response: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Failed to parse GitHub pull request response: expected an object.");
  }

  return normalizeGithubPullRequest(parsed as GithubPullResponse);
};

const runGithubCommand = async (
  systemCommands: SystemCommandPort,
  repoPath: string,
  host: string,
  args: string[],
): Promise<string> => {
  const hostArgs = host.trim() ? ["--hostname", host.trim(), ...args] : args;
  const result = await systemCommands.runCommandAllowFailure("gh", hostArgs, {
    cwd: repoPath,
    env: GH_NON_INTERACTIVE_ENV,
  });
  if (result.ok) {
    return result.stdout;
  }

  throw new Error(combinedCommandOutput(result.stdout, result.stderr) || "gh command failed.");
};

const matchingGithubRemoteNames = async (
  gitPort: GitPort,
  repoPath: string,
  repository: GitProviderRepository,
): Promise<string[]> => {
  const expectedKey = repositoryKey(repository);
  return (await gitPort.listRemotes(repoPath)).flatMap((remote) => {
    const parsed = parseGithubRemoteUrl(remote.url);
    return parsed !== null && repositoryKey(parsed) === expectedKey ? [remote.name] : [];
  });
};

const requireSingleGithubRemoteName = async (
  gitPort: GitPort,
  repoPath: string,
  repository: GitProviderRepository,
): Promise<string> => {
  const matches = await matchingGithubRemoteNames(gitPort, repoPath, repository);
  if (matches.length === 1) {
    return matches[0] ?? "";
  }
  if (matches.length === 0) {
    throw new Error(
      `No git remote matches the configured GitHub repository ${repository.host}:${repository.owner}/${repository.name}.`,
    );
  }

  throw new Error(
    `Multiple git remotes match the configured GitHub repository ${repository.host}:${repository.owner}/${repository.name}: ${matches.join(", ")}. Configure a single matching remote before opening or updating a pull request.`,
  );
};

const probeGithubAuthOrThrow = async (
  systemCommands: SystemCommandPort,
  host: string,
): Promise<void> => {
  const result = await systemCommands.runCommandAllowFailure(
    "gh",
    ["auth", "status", "--hostname", host],
    { env: GH_NON_INTERACTIVE_ENV },
  );
  if (result.ok) {
    return;
  }
  throw new Error(
    combinedCommandOutput(result.stdout, result.stderr) ||
      "GitHub authentication is not configured. Run `gh auth login`.",
  );
};

const requireGithubPullRequestContext = async (
  dependencies: {
    gitPort: GitPort;
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  repoConfig: RepoConfig,
): Promise<GithubPullRequestContext> => {
  const providerConfig = repoConfig.git.providers[GITHUB_PROVIDER_ID];
  if (!providerConfig?.enabled) {
    throw new Error("GitHub pull request support is not enabled for this repository.");
  }
  const ghError = await dependencies.systemCommands.requiredCommandError("gh");
  if (ghError !== null) {
    throw new Error("GitHub pull request support requires the gh CLI to be installed.");
  }

  const repository = providerConfig.repository;
  if (!repository) {
    throw new Error("GitHub pull request support requires repository coordinates.");
  }
  await probeGithubAuthOrThrow(dependencies.systemCommands, repository.host);
  const remoteName = await requireSingleGithubRemoteName(
    dependencies.gitPort,
    repoPath,
    repository,
  );

  return { repository, remoteName };
};

const selectGithubPullRequestForBranch = (
  pullRequests: ResolvedPullRequest[],
  sourceBranch: string,
  state: "open" | "all",
): ResolvedPullRequest | undefined => {
  if (state === "all") {
    return pullRequests
      .filter((pullRequest) => pullRequest.record.state === "merged")
      .sort((left, right) => left.record.updatedAt.localeCompare(right.record.updatedAt))
      .at(-1);
  }

  if (pullRequests.length > 1) {
    throw new Error(
      `Multiple pull requests were found for branch ${sourceBranch} while querying state=open.`,
    );
  }
  return pullRequests[0];
};

const findGithubPullRequestForBranch = async (
  dependencies: {
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  context: GithubPullRequestContext,
  sourceBranch: string,
  state: "open" | "all",
): Promise<ResolvedPullRequest | undefined> => {
  const repoSlug = `${context.repository.owner}/${context.repository.name}`;
  const payload = await runGithubCommand(
    dependencies.systemCommands,
    repoPath,
    context.repository.host,
    [
      "api",
      "--method",
      "GET",
      `repos/${repoSlug}/pulls`,
      "-f",
      `state=${state}`,
      "-f",
      `head=${context.repository.owner}:${sourceBranch}`,
    ],
  );
  return selectGithubPullRequestForBranch(
    parseGithubPullListResponse(payload),
    sourceBranch,
    state,
  );
};

const fetchGithubPullRequestByNumber = async (
  dependencies: {
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  context: GithubPullRequestContext,
  number: number,
): Promise<ResolvedPullRequest> => {
  const repoSlug = `${context.repository.owner}/${context.repository.name}`;
  const payload = await runGithubCommand(
    dependencies.systemCommands,
    repoPath,
    context.repository.host,
    ["api", `repos/${repoSlug}/pulls/${number}`],
  );
  return parseGithubPullResponse(payload);
};

type GithubPullRequestSyncPolicy = {
  providerId: typeof GITHUB_PROVIDER_ID;
  available: boolean;
  repository?: GitProviderRepository;
};

const githubPullRequestSyncPolicy = async (
  systemCommands: SystemCommandPort,
  repoConfig: RepoConfig,
): Promise<GithubPullRequestSyncPolicy> => {
  const providerConfig = repoConfig.git.providers[GITHUB_PROVIDER_ID];
  const ghError =
    providerConfig?.enabled === true ? await systemCommands.requiredCommandError("gh") : "missing";

  const policy: GithubPullRequestSyncPolicy = {
    providerId: GITHUB_PROVIDER_ID,
    available: providerConfig?.enabled === true && ghError === null,
  };
  if (providerConfig?.repository) {
    policy.repository = providerConfig.repository;
  }

  return policy;
};

const fetchLinkedPullRequest = async (
  dependencies: {
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  policy: GithubPullRequestSyncPolicy,
  pullRequest: PullRequest,
): Promise<ResolvedPullRequest | undefined> => {
  if (pullRequest.providerId !== policy.providerId || !policy.repository) {
    return undefined;
  }

  return fetchGithubPullRequestByNumber(
    dependencies,
    repoPath,
    { repository: policy.repository, remoteName: "" },
    pullRequest.number,
  );
};

const pullRequestRecordsMatch = (left: PullRequest, right: PullRequest): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const isEditablePullRequest = (pullRequest: PullRequest | undefined): boolean =>
  pullRequest?.providerId === GITHUB_PROVIDER_ID &&
  (pullRequest.state === "open" || pullRequest.state === "draft");

const upsertGithubPullRequest = async (
  dependencies: {
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  context: GithubPullRequestContext,
  approval: TaskApprovalContext,
  title: string,
  body: string,
): Promise<PullRequest> => {
  const repoSlug = `${context.repository.owner}/${context.repository.name}`;
  const existingPullRequest = approval.pullRequest;
  const args =
    existingPullRequest !== undefined && isEditablePullRequest(existingPullRequest)
      ? [
          "api",
          "--method",
          "PATCH",
          `repos/${repoSlug}/pulls/${existingPullRequest.number}`,
          "-f",
          `title=${title.trim()}`,
          "-f",
          `body=${body}`,
        ]
      : [
          "api",
          "--method",
          "POST",
          `repos/${repoSlug}/pulls`,
          "-f",
          `title=${title.trim()}`,
          "-f",
          `head=${approval.sourceBranch}`,
          "-f",
          `base=${checkoutBranch(approval.targetBranch)}`,
          "-f",
          `body=${body}`,
        ];
  const payload = await runGithubCommand(
    dependencies.systemCommands,
    repoPath,
    context.repository.host,
    args,
  );

  return parseGithubPullResponse(payload).record;
};

const ensureCleanBuilderWorktree = (approval: TaskApprovalContext): void => {
  if (!approval.hasUncommittedChanges) {
    return;
  }

  const fileLabel =
    approval.uncommittedFileCount === 1
      ? "1 uncommitted file"
      : `${approval.uncommittedFileCount} uncommitted files`;
  const pronoun = approval.uncommittedFileCount === 1 ? "it" : "them";
  throw new Error(
    `Human approval is blocked because the builder worktree has ${fileLabel}. Commit or discard ${pronoun} before merging or opening a pull request.`,
  );
};

const directMergeConflict = (
  repoPath: string,
  approval: TaskApprovalContext,
  method: GitMergeMethod,
  conflictedFiles: string[],
  output: string,
): GitConflict => {
  if (method === "merge_commit") {
    return {
      operation: "direct_merge_merge_commit",
      currentBranch: checkoutBranch(approval.targetBranch),
      targetBranch: canonicalTargetBranch(approval.targetBranch),
      conflictedFiles,
      output,
      workingDir: repoPath,
    };
  }
  if (method === "squash") {
    return {
      operation: "direct_merge_squash",
      currentBranch: checkoutBranch(approval.targetBranch),
      targetBranch: canonicalTargetBranch(approval.targetBranch),
      conflictedFiles,
      output,
      workingDir: repoPath,
    };
  }

  return {
    operation: "direct_merge_rebase",
    currentBranch: approval.sourceBranch,
    targetBranch: canonicalTargetBranch(approval.targetBranch),
    conflictedFiles,
    output,
    workingDir: approval.workingDirectory,
  };
};

const loadOpenApprovalContext = async (
  dependencies: {
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
    systemCommands: SystemCommandPort;
    taskWorktreeService: TaskWorktreeService;
    workspaceSettingsService: WorkspaceSettingsService;
  },
  taskId: string,
  current: TaskCard,
  metadata: TaskMetadataPayload,
  repoConfig: RepoConfig,
): Promise<TaskApprovalContext> => {
  ensureHumanApprovalStatus(current.status);

  const effectiveRepoPath = repoConfig.repoPath;
  const defaultMergeMethod = await loadDefaultMergeMethod(dependencies.settingsConfig);
  const providers = await providerStatuses(dependencies, effectiveRepoPath, repoConfig);
  const taskWorktree = await dependencies.taskWorktreeService.getTaskWorktree({
    repoPath: effectiveRepoPath,
    taskId,
  });
  if (!taskWorktree) {
    throw new Error(
      `Human approval requires a builder worktree for task ${taskId}. Start Builder first.`,
    );
  }

  const currentBranch = await dependencies.gitPort.getCurrentBranch(taskWorktree.workingDirectory);
  if (currentBranch.detached) {
    throw new Error(
      "Human approval requires a builder branch, but the builder worktree is detached.",
    );
  }
  const sourceBranch = currentBranch.name?.trim();
  if (!sourceBranch) {
    throw new Error("Human approval requires a builder branch name.");
  }

  const targetBranch = normalizeApprovalTargetBranch(
    await effectiveTargetBranchForTask(
      dependencies.workspaceSettingsService,
      current,
      effectiveRepoPath,
    ),
  );
  const publishTarget =
    current.targetBranch === undefined
      ? publishTargetFromTargetBranch(repoConfig.defaultTargetBranch)
      : publishTargetFromTargetBranch(current.targetBranch);
  const targetRef = canonicalTargetBranch(targetBranch);
  const worktreeStatus = await dependencies.gitPort.getWorktreeStatusSummaryData(
    taskWorktree.workingDirectory,
    targetRef,
    "uncommitted",
  );
  const suggestedSquashCommitMessage = await dependencies.gitPort.suggestedSquashCommitMessage(
    effectiveRepoPath,
    sourceBranch,
    targetRef,
  );

  return {
    taskId,
    taskStatus: current.status,
    workingDirectory: taskWorktree.workingDirectory,
    sourceBranch,
    targetBranch,
    publishTarget,
    defaultMergeMethod,
    hasUncommittedChanges: worktreeStatus.fileStatusCounts.total > 0,
    uncommittedFileCount: worktreeStatus.fileStatusCounts.total,
    pullRequest: metadata.pullRequest,
    providers,
    suggestedSquashCommitMessage,
  };
};

const providerStatuses = async (
  dependencies: {
    gitPort: GitPort;
    systemCommands: SystemCommandPort;
  },
  repoPath: string,
  repoConfig: RepoConfig,
): Promise<GitProviderAvailability[]> => [
  await githubProviderStatus(dependencies, repoPath, repoConfig),
];

const parseHookCommand = (hook: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const character of hook) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === "\\") {
      escaping = true;
      continue;
    }

    if (quote !== null) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (escaping) {
    current += "\\";
  }
  if (quote !== null) {
    throw new Error("Invalid hook command syntax. Use argv tokens, or explicitly invoke a shell.");
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  if (tokens.length === 0) {
    throw new Error("Hook command is empty. Provide an executable name.");
  }

  return tokens;
};

const runHookCommandsAllowFailure = async (
  systemCommands: SystemCommandPort,
  hooks: string[],
  cwd: string,
): Promise<{ hook: string; stderr: string } | null> => {
  for (const hook of hooks) {
    let argv: string[];
    try {
      argv = parseHookCommand(hook);
    } catch (error) {
      return {
        hook,
        stderr: error instanceof Error ? error.message : String(error),
      };
    }

    const [command, ...args] = argv;
    if (command === undefined) {
      return { hook, stderr: "Hook command is empty. Provide an executable name." };
    }
    try {
      const result = await systemCommands.runCommandAllowFailure(command, args, { cwd });
      if (!result.ok) {
        return { hook, stderr: result.stderr };
      }
    } catch (error) {
      return {
        hook,
        stderr: `Failed to execute hook command: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  return null;
};

const slugifyTitle = (value: string): string => {
  let slug = "";
  for (const character of value) {
    if (/^[a-zA-Z0-9]$/.test(character)) {
      slug += character.toLowerCase();
      continue;
    }
    if ((/\s/.test(character) || character === "-" || character === "_") && !slug.endsWith("-")) {
      slug += "-";
    }
  }

  return slug.replace(/^-+|-+$/g, "").slice(0, 40);
};

const buildBranchName = (prefix: string, taskId: string, title: string): string => {
  const cleanPrefix = prefix.trim().replace(/\/+$/g, "") || DEFAULT_BRANCH_PREFIX;
  const slug = slugifyTitle(title);
  return slug ? `${cleanPrefix}/${taskId}-${slug}` : `${cleanPrefix}/${taskId}`;
};

const normalizedParentId = (task: TaskCreateInput): string | undefined => {
  const trimmed = task.parentId?.trim();
  return trimmed ? trimmed : undefined;
};

const validateParentRelationshipsForCreate = (tasks: TaskCard[], input: TaskCreateInput): void => {
  const parentId = normalizedParentId(input);
  if (input.issueType === "epic" && parentId !== undefined) {
    throw new Error("Epics cannot be created as subtasks.");
  }

  if (parentId === undefined) {
    return;
  }

  const parent = tasks.find((task) => task.id === parentId);
  if (!parent) {
    throw new Error(`Task not found: ${parentId}`);
  }
  if (parent.issueType !== "epic") {
    throw new Error("Only epics can have subtasks.");
  }
  if (parent.parentId !== undefined) {
    throw new Error("Subtask depth is limited to one level.");
  }
};

const nextParentIdForUpdate = (current: TaskCard, patch: TaskUpdatePatch): string | undefined => {
  if (patch.parentId === undefined) {
    return current.parentId;
  }

  const trimmed = patch.parentId.trim();
  return trimmed ? trimmed : undefined;
};

const validateParentRelationshipsForUpdate = (
  tasks: TaskCard[],
  current: TaskCard,
  patch: TaskUpdatePatch,
): void => {
  const nextIssueType = patch.issueType ?? current.issueType;
  const nextParentId = nextParentIdForUpdate(current, patch);

  if (nextIssueType === "epic" && nextParentId !== undefined) {
    throw new Error("Epics cannot be converted to subtasks.");
  }

  const hasDirectSubtasks = tasks.some((task) => task.parentId === current.id);
  if (hasDirectSubtasks && nextParentId !== undefined) {
    throw new Error("Tasks with subtasks cannot become subtasks.");
  }
  if (hasDirectSubtasks && nextIssueType !== "epic") {
    throw new Error("Only epics can have subtasks.");
  }

  if (nextParentId === undefined) {
    return;
  }

  const parent = tasks.find((task) => task.id === nextParentId);
  if (!parent) {
    throw new Error(`Task not found: ${nextParentId}`);
  }
  if (parent.issueType !== "epic") {
    throw new Error("Only epics can be selected as parents.");
  }
  if (parent.parentId !== undefined) {
    throw new Error("Subtask depth is limited to one level.");
  }
};

const normalizePlanSubtasks = (inputs: PlanSubtaskInput[]): TaskCreateInput[] =>
  inputs.map((input) => {
    const title = input.title.trim();
    if (!title) {
      throw new Error("Subtask proposals require a non-empty title.");
    }

    const issueType = input.issueType ?? "task";
    const description = input.description?.trim();
    return {
      title,
      issueType,
      priority: input.priority ?? 2,
      description: description ? description : undefined,
      aiReviewEnabled: true,
    };
  });

const validatePlanSubtaskRules = (
  task: TaskCard,
  allTasks: TaskCard[],
  planSubtasks: TaskCreateInput[],
): void => {
  if (task.issueType !== "epic") {
    if (planSubtasks.length > 0) {
      throw new Error("Only epics can receive subtask proposals during planning.");
    }
    return;
  }

  const hasDirectSubtasks = allTasks.some((entry) => entry.parentId === task.id);
  if (!hasDirectSubtasks && planSubtasks.length === 0) {
    throw new Error("Epic plans must provide at least one direct subtask proposal.");
  }
};

const validateEpicSubtasksReplaceable = (task: TaskCard, allTasks: TaskCard[]): void => {
  const blockedSubtasks = allTasks
    .filter((entry) => entry.parentId === task.id)
    .filter((entry) => !canReplaceEpicSubtaskStatus(entry.status))
    .map((entry) => `${entry.id} (${entry.status})`);

  if (blockedSubtasks.length > 0) {
    throw new Error(
      `Cannot replace epic subtasks while active work exists. Move subtasks to open/spec_ready/ready_for_dev first: ${blockedSubtasks.join(", ")}`,
    );
  }
};

const replaceEpicPlanSubtasks = async (
  taskStore: TaskStorePort,
  repoPath: string,
  task: TaskCard,
  currentTasks: TaskCard[],
  subtaskCreates: TaskCreateInput[],
): Promise<void> => {
  const directSubtasks = currentTasks.filter((entry) => entry.parentId === task.id);
  for (const subtask of directSubtasks) {
    await taskStore.deleteTask({ repoPath, taskId: subtask.id, deleteSubtasks: false });
  }

  const remainingTasks = currentTasks.filter((entry) => entry.parentId !== task.id);
  const proposalTitles = new Set<string>();
  for (const createInput of subtaskCreates) {
    const titleKey = createInput.title.trim().toLowerCase();
    if (proposalTitles.has(titleKey)) {
      continue;
    }
    proposalTitles.add(titleKey);

    const taskInput = { ...createInput, parentId: task.id };
    validateParentRelationshipsForCreate(remainingTasks, taskInput);
    const created = await taskStore.createTask({ repoPath, task: taskInput });
    remainingTasks.push(created);
  }
};

const taskListWithCurrent = async (
  taskStore: TaskStorePort,
  repoPath: string,
  taskId: string,
): Promise<{ current: TaskCard; currentTasks: TaskCard[] }> => {
  const currentTasks = await taskStore.listTasks({ repoPath });
  const current = currentTasks.find((task) => task.id === taskId);
  if (!current) {
    throw new Error(`Task not found: ${taskId}`);
  }

  return { current, currentTasks };
};

const recordQaOutcome = async (
  taskStore: TaskStorePort,
  input: {
    repoPath: string;
    taskId: string;
    markdown: string;
    verdict: QaReportVerdict;
    targetStatus: "human_review" | "in_progress";
  },
): Promise<TaskCard> => {
  const { repoPath, taskId, markdown, verdict, targetStatus } = input;
  const { current, currentTasks } = await taskListWithCurrent(taskStore, repoPath, taskId);
  if (current.status !== "ai_review" && current.status !== "human_review") {
    throw new Error(
      `QA outcomes are only allowed from ai_review or human_review (current: ${current.status}).`,
    );
  }
  validateTransition(current, currentTasks, current.status, targetStatus);

  const updated = await taskStore.recordQaOutcome({
    repoPath,
    taskId,
    status: targetStatus,
    markdown,
    verdict,
  });
  const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

  return enrichTask(updated, nextTasks);
};

const buildCompletionWorktreePath = async (
  settingsConfig: SettingsConfigPort,
  repoConfig: RepoConfig,
  taskId: string,
): Promise<string> => {
  const basePath =
    repoConfig.worktreeBasePath === undefined
      ? settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId)
      : settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath);
  const worktreePath = settingsConfig.join(basePath, taskId);

  if (!(await settingsConfig.pathExists(worktreePath))) {
    throw new Error(
      `Worktree cleanup scripts require a builder worktree for task ${taskId}. Start Builder first.`,
    );
  }

  const canonicalRepoPath = await settingsConfig.canonicalizePath(repoConfig.repoPath);
  const canonicalWorktreePath = await settingsConfig.canonicalizePath(worktreePath);
  if (canonicalRepoPath === canonicalWorktreePath) {
    throw new Error(
      `Worktree cleanup scripts require a builder worktree for task ${taskId}. Start Builder first.`,
    );
  }

  return worktreePath;
};

const blockBuildCompletionTask = async (
  taskStore: TaskStorePort,
  repoPath: string,
  taskId: string,
  current: TaskCard,
  currentTasks: TaskCard[],
): Promise<void> => {
  validateTransition(current, currentTasks, current.status, "blocked");
  await taskStore.transitionTask({ repoPath, taskId, status: "blocked" });
};

const checkoutBranch = (targetBranch: GitTargetBranch): string => targetBranch.branch.trim();

const canonicalTargetBranch = (targetBranch: GitTargetBranch): string => {
  const branch = checkoutBranch(targetBranch);
  const remote = targetBranch.remote?.trim();
  return remote ? `${remote}/${branch}` : branch;
};

const normalizePathForComparison = (value: string): string => {
  const absolute = value.trim().replace(/\\/g, "/");
  const segments: string[] = [];
  for (const segment of absolute.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return absolute.startsWith("/") ? `/${segments.join("/")}` : segments.join("/");
};

const findLatestCleanupTarget = async (
  dependencies: {
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
    taskWorktreeService: TaskWorktreeService;
  },
  taskStore: TaskStorePort,
  repoPath: string,
  taskId: string,
  preferredSourceBranch: string,
): Promise<string | undefined> => {
  const candidates: Array<{
    workingDirectory: string;
    startedAt: string;
    externalSessionId: string;
  }> = [];
  const taskWorktree = await dependencies.taskWorktreeService.getTaskWorktree({ repoPath, taskId });
  if (taskWorktree) {
    candidates.push({
      workingDirectory: taskWorktree.workingDirectory,
      startedAt: "\uffff",
      externalSessionId: "task-worktree",
    });
  }

  const tasks = await taskStore.listTasks({ repoPath });
  const task = tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  candidates.push(
    ...(task.agentSessions ?? [])
      .filter((session) => session.role.trim() === "build")
      .map((session) => ({
        workingDirectory: session.workingDirectory,
        startedAt: session.startedAt,
        externalSessionId: session.externalSessionId,
      })),
  );
  candidates.sort((left, right) => {
    const startedAtComparison = right.startedAt.localeCompare(left.startedAt);
    return startedAtComparison === 0
      ? right.externalSessionId.localeCompare(left.externalSessionId)
      : startedAtComparison;
  });

  for (const candidate of candidates) {
    const workingDirectory = candidate.workingDirectory.trim();
    if (!workingDirectory) {
      continue;
    }
    if (!(await dependencies.settingsConfig.pathExists(workingDirectory))) {
      return workingDirectory;
    }
    const currentBranch = await dependencies.gitPort.getCurrentBranch(workingDirectory);
    const branchName = currentBranch.name?.trim();
    if (!branchName) {
      continue;
    }
    if (branchName !== preferredSourceBranch.trim()) {
      continue;
    }

    return workingDirectory;
  }

  return undefined;
};

const cleanupMergedBuilderState = async (
  dependencies: {
    devServerService: DevServerService;
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
    taskWorktreeService: TaskWorktreeService;
  },
  taskStore: TaskStorePort,
  repoPath: string,
  taskId: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<void> => {
  await dependencies.devServerService.stop({ repoPath, taskId });

  const cleanupTarget = await findLatestCleanupTarget(
    dependencies,
    taskStore,
    repoPath,
    taskId,
    sourceBranch,
  );
  if (
    cleanupTarget &&
    normalizePathForComparison(cleanupTarget) !== normalizePathForComparison(repoPath) &&
    (await dependencies.settingsConfig.pathExists(cleanupTarget))
  ) {
    await dependencies.gitPort.removeWorktree(repoPath, cleanupTarget, false);
  }

  const sourceBranchExists = (await dependencies.gitPort.listBranches(repoPath)).some(
    (branch) => !branch.isRemote && branch.name === sourceBranch,
  );
  if (!sourceBranchExists) {
    return;
  }

  const forceDelete = !(await dependencies.gitPort.isAncestor(
    repoPath,
    sourceBranch,
    targetBranch,
  ));
  await dependencies.gitPort.deleteLocalBranch(repoPath, sourceBranch, forceDelete);
};

const cleanupDirectMergeBuilderState = async (
  dependencies: {
    devServerService: DevServerService;
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
    taskWorktreeService: TaskWorktreeService;
  },
  taskStore: TaskStorePort,
  repoPath: string,
  taskId: string,
  directMerge: DirectMergeRecord,
): Promise<void> =>
  cleanupMergedBuilderState(
    dependencies,
    taskStore,
    repoPath,
    taskId,
    directMerge.sourceBranch.trim(),
    checkoutBranch(directMerge.targetBranch),
  );

const effectiveTargetBranchForTask = async (
  workspaceSettingsService: WorkspaceSettingsService,
  task: TaskCard,
  repoPath: string,
): Promise<GitTargetBranch> => {
  if (task.targetBranchError) {
    throw new Error(task.targetBranchError);
  }
  if (task.targetBranch) {
    return task.targetBranch;
  }

  const repoConfig = await workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
  return repoConfig.defaultTargetBranch;
};

const resolveBuildStartPoint = async (
  dependencies: ReturnType<typeof requireBuildStartDependencies>,
  repoPath: string,
  targetBranch: GitTargetBranch,
  allowLocalBranchFallback: boolean,
): Promise<{ reference: string; upstreamRemote: string | null }> => {
  const configuredTargetBranch = canonicalTargetBranch(targetBranch);
  if (await dependencies.gitPort.referenceExists(repoPath, configuredTargetBranch)) {
    return {
      reference: configuredTargetBranch,
      upstreamRemote: targetBranch.remote?.trim() || null,
    };
  }

  if (allowLocalBranchFallback && targetBranch.remote?.trim() === "origin") {
    const localBranch = checkoutBranch(targetBranch);
    if (await dependencies.gitPort.referenceExists(repoPath, localBranch)) {
      return { reference: localBranch, upstreamRemote: null };
    }
  }

  throw new Error(
    `Configured target branch is unavailable for build worktree creation: ${configuredTargetBranch}`,
  );
};

const rollbackFailedBuildWorktree = async (
  dependencies: ReturnType<typeof requireBuildStartDependencies>,
  repoPath: string,
  worktreePath: string,
  branch: string,
  createdTrackingRef: string | null,
): Promise<string> => {
  const cleanupErrors: string[] = [];
  if (createdTrackingRef) {
    try {
      await dependencies.gitPort.deleteReference(repoPath, createdTrackingRef);
    } catch (error) {
      cleanupErrors.push(
        `Also failed to delete created upstream tracking ref ${createdTrackingRef}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  try {
    await dependencies.gitPort.removeWorktree(repoPath, worktreePath, true);
  } catch (error) {
    cleanupErrors.push(
      `Also failed to remove worktree ${worktreePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    await dependencies.gitPort.deleteLocalBranch(repoPath, branch, true);
  } catch (error) {
    cleanupErrors.push(
      `Also failed to delete branch ${branch}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return cleanupErrors.length === 0 ? "" : `\n${cleanupErrors.join("\n")}`;
};

const resolveRuntimeDescriptorForBuild = (
  runtimeDefinitionsService: RuntimeDefinitionsService,
  runtimeKind: string,
) => {
  const descriptor = runtimeDefinitionsService
    .listRuntimeDefinitions()
    .find((definition) => definition.kind === runtimeKind);
  if (!descriptor) {
    throw new Error(`Unsupported runtime kind: ${runtimeKind}`);
  }
  if (!descriptor.capabilities.workflow.supportsOdtWorkflowTools) {
    throw new Error(`${runtimeKind} runtime does not support OpenDucktor workflow tools.`);
  }

  const scopes = descriptor.capabilities.workflow.supportedScopes;
  const requiredScopes = ["workspace", "task", "build"] as const;
  const missingScopes = requiredScopes.filter((scope) => !scopes.includes(scope));
  if (missingScopes.length > 0) {
    throw new Error(
      `${runtimeKind} runtime is missing required workflow scopes: ${missingScopes.join(", ")}`,
    );
  }

  return descriptor;
};

const loadBuilderBranchCleanup = async (
  dependencies: {
    gitPort: GitPort;
    taskWorktreeService: TaskWorktreeService;
    workspaceSettingsService: WorkspaceSettingsService;
  },
  task: TaskCard,
  repoPath: string,
  taskId: string,
  operationLabel: string,
): Promise<{ sourceBranch: string; targetBranch: string }> => {
  const taskWorktree = await dependencies.taskWorktreeService.getTaskWorktree({ repoPath, taskId });
  if (!taskWorktree) {
    throw new Error(
      `${operationLabel} requires a builder worktree for task ${taskId}. Start Builder first.`,
    );
  }

  const currentBranch = await dependencies.gitPort.getCurrentBranch(taskWorktree.workingDirectory);
  if (currentBranch.detached) {
    throw new Error(
      `${operationLabel} requires a builder branch, but the builder worktree is detached.`,
    );
  }
  const sourceBranch = currentBranch.name?.trim();
  if (!sourceBranch) {
    throw new Error(`${operationLabel} requires a builder branch name.`);
  }

  const targetBranch = await effectiveTargetBranchForTask(
    dependencies.workspaceSettingsService,
    task,
    repoPath,
  );
  return { sourceBranch, targetBranch: checkoutBranch(targetBranch) };
};

const canSkipRelinkedPullRequestCleanup = (message: string): boolean =>
  message.includes("requires a builder worktree for task") ||
  message.includes("the builder worktree is detached") ||
  message.includes("requires a builder branch name");

const implementationSessionRoleNames = ["build", "qa"] as const;
const taskResetSessionRoleNames = ["spec", "planner", "build", "qa"] as const;
const implementationSessionRoles = new Set<string>(implementationSessionRoleNames);
const taskResetSessionRoles = new Set<string>(taskResetSessionRoleNames);

const taskHasImplementationSessions = (task: TaskCard): boolean =>
  (task.agentSessions ?? []).some((session) => implementationSessionRoles.has(session.role.trim()));

const collectTaskDeleteTargets = (
  tasks: TaskCard[],
  taskId: string,
  deleteSubtasks: boolean,
): TaskCard[] => {
  const targetIds = new Set([taskId]);
  if (deleteSubtasks) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of tasks) {
        if (task.parentId && targetIds.has(task.parentId) && !targetIds.has(task.id)) {
          targetIds.add(task.id);
          changed = true;
        }
      }
    }
  }

  return tasks.filter((task) => targetIds.has(task.id));
};

const relatedTaskBranch = (branchName: string, branchPrefix: string, taskId: string): boolean => {
  const cleanPrefix = branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
  const taskPrefix = `${cleanPrefix}/${taskId}`;
  return branchName === taskPrefix || branchName.startsWith(`${taskPrefix}-`);
};

const collectRelatedTaskBranches = async (
  gitPort: GitPort,
  repoPath: string,
  branchPrefix: string,
  taskIds: string[],
): Promise<string[]> => {
  const branches = await gitPort.listBranches(repoPath);
  const names = new Set<string>();
  for (const branch of branches) {
    if (branch.isRemote) {
      continue;
    }
    if (taskIds.some((taskId) => relatedTaskBranch(branch.name, branchPrefix, taskId))) {
      names.add(branch.name);
    }
  }

  return [...names].sort();
};

const collectDeleteWorktreePaths = async (
  dependencies: {
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
  },
  repoPath: string,
  branchPrefix: string,
  targetTasks: TaskCard[],
): Promise<string[]> => {
  const normalizedRepo = normalizePathForComparison(repoPath);
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const task of targetTasks) {
    for (const session of task.agentSessions ?? []) {
      if (!implementationSessionRoles.has(session.role.trim())) {
        continue;
      }
      const workingDirectory = session.workingDirectory.trim();
      if (!workingDirectory) {
        continue;
      }
      const normalizedWorktree = normalizePathForComparison(workingDirectory);
      if (normalizedWorktree === normalizedRepo) {
        continue;
      }
      if (await dependencies.settingsConfig.pathExists(workingDirectory)) {
        const currentBranch = await dependencies.gitPort.getCurrentBranch(workingDirectory);
        const branchName = currentBranch.name?.trim();
        if (!branchName || !relatedTaskBranch(branchName, branchPrefix, task.id)) {
          continue;
        }
      }
      if (!seen.has(normalizedWorktree)) {
        seen.add(normalizedWorktree);
        paths.push(workingDirectory);
      }
    }
  }

  return paths;
};

const collectResetWorktreePaths = async (
  dependencies: {
    gitPort: GitPort;
    settingsConfig: SettingsConfigPort;
  },
  repoPath: string,
  branchPrefix: string,
  task: TaskCard,
  sessionRoles: Set<string>,
  operationLabel: "reset implementation" | "reset task",
): Promise<string[]> => {
  const normalizedRepo = normalizePathForComparison(repoPath);
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const session of task.agentSessions ?? []) {
    if (!sessionRoles.has(session.role.trim())) {
      continue;
    }
    const workingDirectory = session.workingDirectory.trim();
    if (!workingDirectory) {
      continue;
    }
    const normalizedWorktree = normalizePathForComparison(workingDirectory);
    if (normalizedWorktree === normalizedRepo) {
      continue;
    }
    if (await dependencies.settingsConfig.pathExists(workingDirectory)) {
      const currentBranch = await dependencies.gitPort.getCurrentBranch(workingDirectory);
      const branchName = currentBranch.name?.trim();
      if (!branchName) {
        throw new Error(
          `Cannot ${operationLabel} task ${task.id} because worktree ${workingDirectory} is detached or has no active branch.`,
        );
      }
      if (!relatedTaskBranch(branchName, branchPrefix, task.id)) {
        continue;
      }
    }
    if (!seen.has(normalizedWorktree)) {
      seen.add(normalizedWorktree);
      paths.push(workingDirectory);
    }
  }

  return paths;
};

const appendDeleteCleanupProgress = (
  error: unknown,
  removedWorktrees: string[],
  deletedBranches: string[],
): Error => {
  const base = error instanceof Error ? error : new Error(String(error));
  const progress: string[] = [];
  if (removedWorktrees.length > 0) {
    progress.push(`Delete cleanup already removed worktrees: ${removedWorktrees.join(", ")}.`);
  }
  if (deletedBranches.length > 0) {
    progress.push(`Delete cleanup already deleted branches: ${deletedBranches.join(", ")}.`);
  }
  if (progress.length === 0) {
    return base;
  }

  progress.push("Retry delete to finish cleanup safely.");
  return new Error(`${base.message}\n${progress.join("\n")}`, { cause: base });
};

const appendResetCleanupProgress = (
  error: unknown,
  removedWorktrees: string[],
  deletedBranches: string[],
  completedSteps: string[] = [],
): Error => {
  const base = error instanceof Error ? error : new Error(String(error));
  const progress: string[] = [];
  if (removedWorktrees.length > 0) {
    progress.push(`Reset cleanup already removed worktrees: ${removedWorktrees.join(", ")}.`);
  }
  if (deletedBranches.length > 0) {
    progress.push(`Reset cleanup already deleted branches: ${deletedBranches.join(", ")}.`);
  }
  if (completedSteps.length > 0) {
    progress.push(`Reset cleanup already completed: ${completedSteps.join(", ")}.`);
  }
  if (progress.length === 0) {
    return base;
  }

  progress.push("Retry reset to finish cleanup safely.");
  return new Error(`${base.message}\n${progress.join("\n")}`, { cause: base });
};

const taskHasSessionsForRoles = (task: TaskCard, roles: Set<string>): boolean =>
  (task.agentSessions ?? []).some((session) => roles.has(session.role.trim()));

const resetImplementationRollbackStatus = (task: TaskCard): TaskStatus => {
  if (task.documentSummary.plan.has) {
    return "ready_for_dev";
  }
  if (task.documentSummary.spec.has) {
    return "spec_ready";
  }
  return "open";
};

const replaceTaskInList = (tasks: TaskCard[], updated: TaskCard): TaskCard[] =>
  tasks.map((task) => (task.id === updated.id ? updated : task));

export const createTaskService = ({
  devServerService,
  gitPort,
  taskStore,
  taskActivityGuard,
  settingsConfig,
  systemCommands,
  taskWorktreeService,
  workspaceSettingsService,
  runtimeDefinitionsService,
  runtimeRegistry,
  worktreeFiles,
}: CreateTaskServiceInput): TaskService => ({
  async listTasks(input) {
    const record = requireRecord(input, "tasks_list input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const doneVisibleDays = optionalNonNegativeInteger(record.doneVisibleDays, "doneVisibleDays");
    const listInput = doneVisibleDays === undefined ? { repoPath } : { repoPath, doneVisibleDays };
    const tasks = await taskStore.listTasks(listInput);

    return enrichTasks(tasks);
  },

  async getTaskMetadata(input) {
    const record = requireRecord(input, "task_metadata_get input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");

    return taskStore.getTaskMetadata({ repoPath, taskId });
  },

  async agentSessionsList(input) {
    const record = requireRecord(input, "agent_sessions_list input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const metadata = await taskStore.getTaskMetadata({ repoPath, taskId });

    return metadata.agentSessions;
  },

  async agentSessionsListBulk(input) {
    const record = requireRecord(input, "agent_sessions_list_bulk input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskIds = parseTaskIdList(record.taskIds, "taskIds");
    if (taskIds.length === 0) {
      return {};
    }

    const currentTasks = await taskStore.listTasks({ repoPath });
    const sessionsByAvailableTask = new Map(
      currentTasks.map((task) => [task.id, task.agentSessions ?? []]),
    );
    const sessionsByTask: Record<string, AgentSessionRecord[]> = {};
    for (const taskId of taskIds) {
      const sessions = sessionsByAvailableTask.get(taskId);
      if (sessions === undefined) {
        throw new Error(`Task not found: ${taskId}`);
      }
      sessionsByTask[taskId] = sessions;
    }

    return sessionsByTask;
  },

  async agentSessionUpsert(input) {
    const record = requireRecord(input, "agent_session_upsert input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const session = compactAgentSessionForStorage(parseAgentSessionRecord(record.session));
    const dependencies = requireAgentSessionDependencies(
      taskStore,
      settingsConfig,
      workspaceSettingsService,
    );

    await validateAgentSessionWorkingDirectory(
      dependencies.settingsConfig,
      dependencies.workspaceSettingsService,
      repoPath,
      session,
    );
    await dependencies.upsertAgentSession({ repoPath, taskId, session });

    return true;
  },

  async getApprovalContext(input) {
    const record = requireRecord(input, "task_approval_context_get input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const dependencies = requireApprovalContextDependencies(
      gitPort,
      settingsConfig,
      systemCommands,
      taskWorktreeService,
      workspaceSettingsService,
    );

    const current = await taskStore.getTask({ repoPath, taskId });
    ensureHumanApprovalStatus(current.status);
    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const effectiveRepoPath = repoConfig.repoPath;
    const metadata = await taskStore.getTaskMetadata({ repoPath: effectiveRepoPath, taskId });
    const defaultMergeMethod = await loadDefaultMergeMethod(dependencies.settingsConfig);
    const providers = await providerStatuses(dependencies, effectiveRepoPath, repoConfig);

    if (metadata.directMerge !== undefined) {
      const directMerge = metadata.directMerge;
      const targetBranch = normalizeApprovalTargetBranch(directMerge.targetBranch);
      const cleanupTarget = await findLatestCleanupTarget(
        dependencies,
        taskStore,
        effectiveRepoPath,
        taskId,
        directMerge.sourceBranch,
      );
      const workingDirectory =
        cleanupTarget && (await dependencies.settingsConfig.pathExists(cleanupTarget))
          ? cleanupTarget
          : undefined;

      return {
        outcome: "ready",
        approvalContext: {
          taskId,
          taskStatus: current.status,
          workingDirectory,
          sourceBranch: directMerge.sourceBranch,
          targetBranch,
          publishTarget: publishTargetFromTargetBranch(targetBranch),
          defaultMergeMethod,
          hasUncommittedChanges: false,
          uncommittedFileCount: 0,
          pullRequest: metadata.pullRequest,
          directMerge,
          providers,
        },
      };
    }

    const taskWorktree = await dependencies.taskWorktreeService.getTaskWorktree({
      repoPath: effectiveRepoPath,
      taskId,
    });
    if (!taskWorktree) {
      return {
        outcome: "missing_builder_worktree",
        taskId,
        taskStatus: current.status,
      };
    }

    const currentBranch = await dependencies.gitPort.getCurrentBranch(
      taskWorktree.workingDirectory,
    );
    if (currentBranch.detached) {
      throw new Error(
        "Human approval requires a builder branch, but the builder worktree is detached.",
      );
    }
    const sourceBranch = currentBranch.name?.trim();
    if (!sourceBranch) {
      throw new Error("Human approval requires a builder branch name.");
    }

    const targetBranch = normalizeApprovalTargetBranch(
      await effectiveTargetBranchForTask(
        dependencies.workspaceSettingsService,
        current,
        effectiveRepoPath,
      ),
    );
    const publishTarget =
      current.targetBranch === undefined
        ? publishTargetFromTargetBranch(repoConfig.defaultTargetBranch)
        : publishTargetFromTargetBranch(current.targetBranch);
    const targetRef = canonicalTargetBranch(targetBranch);
    const worktreeStatus = await dependencies.gitPort.getWorktreeStatusSummaryData(
      taskWorktree.workingDirectory,
      targetRef,
      "uncommitted",
    );
    const suggestedSquashCommitMessage = await dependencies.gitPort.suggestedSquashCommitMessage(
      effectiveRepoPath,
      sourceBranch,
      targetRef,
    );

    return {
      outcome: "ready",
      approvalContext: {
        taskId,
        taskStatus: current.status,
        workingDirectory: taskWorktree.workingDirectory,
        sourceBranch,
        targetBranch,
        publishTarget,
        defaultMergeMethod,
        hasUncommittedChanges: worktreeStatus.fileStatusCounts.total > 0,
        uncommittedFileCount: worktreeStatus.fileStatusCounts.total,
        pullRequest: metadata.pullRequest,
        providers,
        suggestedSquashCommitMessage,
      },
    };
  },

  async detectPullRequest(input) {
    const record = requireRecord(input, "task_pull_request_detect input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const dependencies = requirePullRequestDetectionDependencies(
      gitPort,
      systemCommands,
      taskWorktreeService,
      workspaceSettingsService,
    );
    if (!taskStore.setPullRequest) {
      throw new Error("Task store port is required to support task_pull_request_detect.");
    }

    const current = await taskStore.getTask({ repoPath, taskId });
    ensurePullRequestManagementStatus(current.status);
    const metadata = await taskStore.getTaskMetadata({ repoPath, taskId });
    if (metadata.pullRequest !== undefined) {
      throw new Error(`Task ${taskId} already has a linked pull request.`);
    }
    if (metadata.directMerge !== undefined) {
      throw new Error(
        `A local direct merge is already recorded for task ${taskId}. Finish the direct merge workflow before linking a merged pull request.`,
      );
    }

    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const effectiveRepoPath = repoConfig.repoPath;
    const builderContext = await loadBuilderBranchCleanup(
      dependencies,
      current,
      effectiveRepoPath,
      taskId,
      "Pull request detection",
    );
    const githubContext = await requireGithubPullRequestContext(
      dependencies,
      effectiveRepoPath,
      repoConfig,
    );
    const openPullRequest = await findGithubPullRequestForBranch(
      dependencies,
      effectiveRepoPath,
      githubContext,
      builderContext.sourceBranch,
      "open",
    );
    if (openPullRequest !== undefined) {
      await taskStore.setPullRequest({
        repoPath: effectiveRepoPath,
        taskId,
        pullRequest: openPullRequest.record,
      });
      return {
        outcome: "linked",
        pullRequest: openPullRequest.record,
      };
    }

    const pullRequest = await findGithubPullRequestForBranch(
      dependencies,
      effectiveRepoPath,
      githubContext,
      builderContext.sourceBranch,
      "all",
    );
    if (pullRequest?.record.state === "merged") {
      return {
        outcome: "merged",
        pullRequest: pullRequest.record,
      };
    }

    return {
      outcome: "not_found",
      sourceBranch: builderContext.sourceBranch,
      targetBranch: builderContext.targetBranch,
    };
  },

  async linkPullRequest(input) {
    const record = requireRecord(input, "task_pull_request_link input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const providerId = requireString(record.providerId, "providerId");
    const number = requirePositiveInteger(record.number, "number");
    if (providerId !== GITHUB_PROVIDER_ID) {
      throw new Error(
        `Unsupported pull request provider for task_pull_request_link: ${providerId}`,
      );
    }
    const dependencies = requirePullRequestLinkDependencies(
      gitPort,
      systemCommands,
      workspaceSettingsService,
    );
    if (!taskStore.setPullRequest) {
      throw new Error("Task store port is required to support task_pull_request_link.");
    }

    const current = await taskStore.getTask({ repoPath, taskId });
    ensurePullRequestManagementStatus(current.status);
    const metadata = await taskStore.getTaskMetadata({ repoPath, taskId });
    if (metadata.pullRequest !== undefined) {
      throw new Error(`Task ${taskId} already has a linked pull request.`);
    }
    if (metadata.directMerge !== undefined) {
      throw new Error(
        `A local direct merge is already recorded for task ${taskId}. Finish the direct merge workflow before linking a pull request.`,
      );
    }

    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const effectiveRepoPath = repoConfig.repoPath;
    const githubContext = await requireGithubPullRequestContext(
      dependencies,
      effectiveRepoPath,
      repoConfig,
    );
    const pullRequest = await fetchGithubPullRequestByNumber(
      dependencies,
      effectiveRepoPath,
      githubContext,
      number,
    );
    await taskStore.setPullRequest({
      repoPath: effectiveRepoPath,
      taskId,
      pullRequest: pullRequest.record,
    });

    return pullRequest.record;
  },

  async upsertPullRequest(input) {
    const record = requireRecord(input, "task_pull_request_upsert input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const content = parsePullRequestContent(record.input);
    const dependencies = requirePullRequestUpsertDependencies(
      gitPort,
      settingsConfig,
      systemCommands,
      taskWorktreeService,
      workspaceSettingsService,
    );
    if (!taskStore.setPullRequest) {
      throw new Error("Task store port is required to support task_pull_request_upsert.");
    }

    const current = await taskStore.getTask({ repoPath, taskId });
    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const effectiveRepoPath = repoConfig.repoPath;
    const metadata = await taskStore.getTaskMetadata({ repoPath: effectiveRepoPath, taskId });
    if (metadata.directMerge !== undefined) {
      throw new Error(
        `A local direct merge is already recorded for task ${taskId}. Finish or discard that direct merge workflow before opening a pull request.`,
      );
    }

    const approval = await loadOpenApprovalContext(
      dependencies,
      taskId,
      current,
      metadata,
      repoConfig,
    );
    ensureCleanBuilderWorktree(approval);
    if (!approval.workingDirectory) {
      throw new Error(
        `Human approval requires a builder worktree for task ${taskId}. Start Builder first.`,
      );
    }

    const githubContext = await requireGithubPullRequestContext(
      dependencies,
      effectiveRepoPath,
      repoConfig,
    );
    const pushResult = await dependencies.gitPort.pushBranch(
      approval.workingDirectory,
      approval.sourceBranch,
      {
        remote: githubContext.remoteName,
        setUpstream: true,
        forceWithLease: false,
      },
    );
    if (pushResult.outcome === "rejected_non_fast_forward") {
      throw new Error(
        `Failed to push the builder branch before creating the pull request: ${pushResult.output}`,
      );
    }

    const pullRequest = await upsertGithubPullRequest(
      dependencies,
      effectiveRepoPath,
      githubContext,
      approval,
      content.title,
      content.body,
    );
    await taskStore.setPullRequest({ repoPath: effectiveRepoPath, taskId, pullRequest });

    return pullRequest;
  },

  async unlinkPullRequest(input) {
    const record = requireRecord(input, "task_pull_request_unlink input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    if (!taskStore.setPullRequest) {
      throw new Error("Task store port is required to support task_pull_request_unlink.");
    }

    const current = await taskStore.getTask({ repoPath, taskId });
    ensurePullRequestManagementStatus(current.status);
    const metadata = await taskStore.getTaskMetadata({ repoPath, taskId });
    if (metadata.pullRequest === undefined) {
      throw new Error(`Task ${taskId} does not have a linked pull request.`);
    }

    return taskStore.setPullRequest({ repoPath, taskId, pullRequest: null });
  },

  async linkMergedPullRequest(input) {
    const record = requireRecord(input, "task_pull_request_link_merged input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const pullRequest = parsePullRequest(record.pullRequest);

    const { current, currentTasks } = await taskListWithCurrent(taskStore, repoPath, taskId);
    const metadata = await taskStore.getTaskMetadata({ repoPath, taskId });
    const sameExistingPullRequest =
      metadata.pullRequest?.providerId === pullRequest.providerId &&
      metadata.pullRequest.number === pullRequest.number &&
      metadata.pullRequest.state === "merged";
    if (current.status === "closed" && sameExistingPullRequest) {
      return enrichTask(current, currentTasks);
    }

    const dependencies = requireLinkMergedPullRequestDependencies(
      devServerService,
      gitPort,
      settingsConfig,
      taskWorktreeService,
      workspaceSettingsService,
    );
    if (!taskStore.setPullRequest) {
      throw new Error("Task store port is required to support task_pull_request_link_merged.");
    }

    ensurePullRequestManagementStatus(current.status);
    if (metadata.directMerge !== undefined) {
      throw new Error(
        `A local direct merge is already recorded for task ${taskId}. Finish the direct merge workflow before linking a merged pull request.`,
      );
    }
    if (pullRequest.state !== "merged") {
      throw new Error(`Task ${taskId} can only link a merged pull request from detection results.`);
    }
    if (metadata.pullRequest !== undefined && !sameExistingPullRequest) {
      throw new Error(`Task ${taskId} already has a linked pull request.`);
    }

    let cleanup: { sourceBranch: string; targetBranch: string } | null = null;
    if (metadata.pullRequest === undefined) {
      cleanup = await loadBuilderBranchCleanup(
        dependencies,
        current,
        repoPath,
        taskId,
        "Pull request linking",
      );
    } else {
      try {
        cleanup = await loadBuilderBranchCleanup(
          dependencies,
          current,
          repoPath,
          taskId,
          "Pull request linking",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!canSkipRelinkedPullRequestCleanup(message)) {
          throw error;
        }
      }
    }

    await taskStore.setPullRequest({ repoPath, taskId, pullRequest });
    if (cleanup) {
      await cleanupMergedBuilderState(
        dependencies,
        taskStore,
        repoPath,
        taskId,
        cleanup.sourceBranch,
        cleanup.targetBranch,
      );
    }
    validateTransition(current, currentTasks, current.status, "closed");
    const task = await taskStore.transitionTask({ repoPath, taskId, status: "closed" });
    const nextTasks = currentTasks.map((entry) => (entry.id === taskId ? task : entry));

    return enrichTask(task, nextTasks);
  },

  async directMerge(input) {
    const record = requireRecord(input, "task_direct_merge input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const mergeInput = parseTaskDirectMergeInput(record.input);
    const dependencies = requireDirectMergeDependencies(
      devServerService,
      gitPort,
      settingsConfig,
      systemCommands,
      taskWorktreeService,
      workspaceSettingsService,
    );
    if (!taskStore.setDirectMerge) {
      throw new Error("Task store port is required to support task_direct_merge.");
    }

    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const effectiveRepoPath = repoConfig.repoPath;
    const { current, currentTasks } = await taskListWithCurrent(
      taskStore,
      effectiveRepoPath,
      taskId,
    );
    const metadata = await taskStore.getTaskMetadata({ repoPath: effectiveRepoPath, taskId });
    if (metadata.directMerge !== undefined) {
      throw new Error(
        `A local direct merge is already recorded for task ${taskId}. Finish the direct merge workflow before trying again.`,
      );
    }

    const approval = await loadOpenApprovalContext(
      dependencies,
      taskId,
      current,
      metadata,
      repoConfig,
    );
    ensureCleanBuilderWorktree(approval);
    const mergeRequest =
      approval.workingDirectory === undefined
        ? {
            sourceBranch: approval.sourceBranch,
            targetBranch: canonicalTargetBranch(approval.targetBranch),
            method: mergeInput.mergeMethod,
            ...(mergeInput.squashCommitMessage === undefined
              ? {}
              : { squashCommitMessage: mergeInput.squashCommitMessage }),
          }
        : {
            sourceBranch: approval.sourceBranch,
            targetBranch: canonicalTargetBranch(approval.targetBranch),
            sourceWorkingDirectory: approval.workingDirectory,
            method: mergeInput.mergeMethod,
            ...(mergeInput.squashCommitMessage === undefined
              ? {}
              : { squashCommitMessage: mergeInput.squashCommitMessage }),
          };
    const mergeResult = await dependencies.gitPort.mergeBranch(effectiveRepoPath, mergeRequest);
    if (mergeResult.outcome === "conflicts") {
      return {
        outcome: "conflicts",
        conflict: directMergeConflict(
          effectiveRepoPath,
          approval,
          mergeInput.mergeMethod,
          mergeResult.conflictedFiles,
          mergeResult.output,
        ),
      };
    }

    const directMerge: DirectMergeRecord = {
      method: mergeInput.mergeMethod,
      sourceBranch: approval.sourceBranch,
      targetBranch: approval.targetBranch,
      mergedAt: new Date().toISOString(),
    };
    await taskStore.setDirectMerge({
      repoPath: effectiveRepoPath,
      taskId,
      directMerge,
    });

    if (approval.publishTarget !== undefined) {
      if (current.status === "ai_review") {
        validateTransition(current, currentTasks, current.status, "human_review");
        const task = await taskStore.transitionTask({
          repoPath: effectiveRepoPath,
          taskId,
          status: "human_review",
        });
        const nextTasks = currentTasks.map((entry) => (entry.id === taskId ? task : entry));
        return {
          outcome: "completed",
          task: enrichTask(task, nextTasks),
        };
      }

      return {
        outcome: "completed",
        task: enrichTask(current, currentTasks),
      };
    }

    validateTransition(current, currentTasks, current.status, "closed");
    const task = await taskStore.transitionTask({
      repoPath: effectiveRepoPath,
      taskId,
      status: "closed",
    });
    await cleanupDirectMergeBuilderState(
      dependencies,
      taskStore,
      effectiveRepoPath,
      taskId,
      directMerge,
    );
    const nextTasks = currentTasks.map((entry) => (entry.id === taskId ? task : entry));

    return {
      outcome: "completed",
      task: enrichTask(task, nextTasks),
    };
  },

  async completeDirectMerge(input) {
    const record = requireRecord(input, "task_direct_merge_complete input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const dependencies = requireDirectMergeCompleteDependencies(
      devServerService,
      gitPort,
      settingsConfig,
      taskWorktreeService,
    );
    const { current, currentTasks } = await taskListWithCurrent(taskStore, repoPath, taskId);
    const metadata = await taskStore.getTaskMetadata({ repoPath, taskId });
    const directMerge = metadata.directMerge;
    if (directMerge === undefined) {
      throw new Error(`Task ${taskId} does not have a locally applied direct merge to complete.`);
    }

    if (directMerge.targetBranch.remote !== undefined) {
      const currentBranch = await dependencies.gitPort.getCurrentBranch(repoPath);
      const currentBranchName = currentBranch.name?.trim();
      if (!currentBranchName) {
        throw new Error(
          `Cannot finish the direct merge for task ${taskId} because the target branch checkout is not active.`,
        );
      }
      const expectedBranch = checkoutBranch(directMerge.targetBranch);
      if (currentBranchName !== expectedBranch) {
        throw new Error(
          `Cannot finish the direct merge for task ${taskId} until branch ${expectedBranch} is checked out locally.`,
        );
      }

      const publishTargetRef = canonicalTargetBranch(directMerge.targetBranch);
      const publishSync = await dependencies.gitPort.commitsAheadBehind(repoPath, publishTargetRef);
      if (publishSync.ahead !== 0 || publishSync.behind !== 0) {
        throw new Error(
          `Cannot finish the direct merge for task ${taskId} until ${publishTargetRef} is fully published and synchronized.`,
        );
      }
    }

    let task = current;
    if (current.status !== "closed") {
      validateTransition(current, currentTasks, current.status, "closed");
      task = await taskStore.transitionTask({ repoPath, taskId, status: "closed" });
    }
    await cleanupDirectMergeBuilderState(dependencies, taskStore, repoPath, taskId, directMerge);
    const nextTasks = currentTasks.map((entry) => (entry.id === taskId ? task : entry));

    return enrichTask(task, nextTasks);
  },

  async createTask(input) {
    const record = requireRecord(input, "task_create input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const task = parseCreateInput(record.input);
    const currentTasks = await taskStore.listTasks({ repoPath });
    validateParentRelationshipsForCreate(currentTasks, task);
    const created = await taskStore.createTask({ repoPath, task });

    return enrichTask(created, [...currentTasks, created]);
  },

  async deleteTask(input) {
    const record = requireRecord(input, "task_delete input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const deleteSubtasks = optionalBoolean(record.deleteSubtasks, "deleteSubtasks") ?? false;
    const dependencies = requireTaskDeleteDependencies(
      devServerService,
      gitPort,
      settingsConfig,
      workspaceSettingsService,
    );
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const directSubtaskIds = currentTasks
      .filter((task) => task.parentId === taskId)
      .map((task) => task.id);
    if (directSubtaskIds.length > 0 && !deleteSubtasks) {
      throw new Error(
        `Task ${taskId} has ${directSubtaskIds.length} subtasks. Confirm subtask deletion to continue.`,
      );
    }

    const targetTasks = collectTaskDeleteTargets(currentTasks, taskId, deleteSubtasks);
    const targetTaskIds = targetTasks.map((task) => task.id);
    if (targetTasks.some(taskHasImplementationSessions)) {
      if (!taskActivityGuard) {
        throw new Error(
          "task_delete requires runtime session activity checks for tasks with build or QA sessions.",
        );
      }
      await taskActivityGuard.ensureNoActiveTaskDeleteRuns({
        repoPath,
        taskIds: targetTaskIds,
        tasks: targetTasks,
      });
    }

    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const effectiveRepoPath = repoConfig.repoPath;
    const branchPrefix = repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
    const worktreePaths = await collectDeleteWorktreePaths(
      dependencies,
      effectiveRepoPath,
      branchPrefix,
      targetTasks,
    );
    const branchNames = await collectRelatedTaskBranches(
      dependencies.gitPort,
      effectiveRepoPath,
      branchPrefix,
      targetTaskIds,
    );
    const removedWorktrees: string[] = [];
    const deletedBranches: string[] = [];

    try {
      for (const targetTaskId of targetTaskIds) {
        await dependencies.devServerService.stop({
          repoPath: effectiveRepoPath,
          taskId: targetTaskId,
        });
      }
      for (const worktreePath of worktreePaths) {
        await dependencies.gitPort.removeWorktree(effectiveRepoPath, worktreePath, true);
        removedWorktrees.push(worktreePath);
      }
      for (const branchName of branchNames) {
        await dependencies.gitPort.deleteLocalBranch(effectiveRepoPath, branchName, true);
        deletedBranches.push(branchName);
      }
      await taskStore.deleteTask({
        repoPath: effectiveRepoPath,
        taskId,
        deleteSubtasks,
      });
    } catch (error) {
      throw appendDeleteCleanupProgress(error, removedWorktrees, deletedBranches);
    }

    return { ok: true };
  },

  async resetImplementation(input) {
    const record = requireRecord(input, "task_reset_implementation input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const dependencies = requireTaskDeleteDependencies(
      devServerService,
      gitPort,
      settingsConfig,
      workspaceSettingsService,
    );
    const storeDependencies = requireImplementationResetStoreDependencies(taskStore);
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (!canResetImplementationFromStatus(current.status)) {
      throw new Error(
        `Implementation reset is only allowed from in_progress, blocked, ai_review, or human_review (current: ${current.status}).`,
      );
    }

    if (taskHasSessionsForRoles(current, implementationSessionRoles)) {
      if (!taskActivityGuard) {
        throw new Error(
          "task_reset_implementation requires runtime session activity checks for tasks with build or QA sessions.",
        );
      }
      await taskActivityGuard.ensureNoActiveTaskResetActivity({
        repoPath,
        taskId,
        sessions: current.agentSessions ?? [],
        operationLabel: "reset implementation",
        sessionRoles: [...implementationSessionRoleNames],
      });
    }

    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const effectiveRepoPath = repoConfig.repoPath;
    const branchPrefix = repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
    const rollbackStatus = resetImplementationRollbackStatus(current);
    const worktreePaths = await collectResetWorktreePaths(
      dependencies,
      effectiveRepoPath,
      branchPrefix,
      current,
      implementationSessionRoles,
      "reset implementation",
    );
    const branchNames = await collectRelatedTaskBranches(
      dependencies.gitPort,
      effectiveRepoPath,
      branchPrefix,
      [taskId],
    );
    const removedWorktrees: string[] = [];
    const deletedBranches: string[] = [];

    try {
      await dependencies.devServerService.stop({ repoPath: effectiveRepoPath, taskId });
      for (const worktreePath of worktreePaths) {
        await dependencies.gitPort.removeWorktree(effectiveRepoPath, worktreePath, true);
        removedWorktrees.push(worktreePath);
      }
      for (const branchName of branchNames) {
        await dependencies.gitPort.deleteLocalBranch(effectiveRepoPath, branchName, true);
        deletedBranches.push(branchName);
      }
      await storeDependencies.clearAgentSessionsByRoles({
        repoPath: effectiveRepoPath,
        taskId,
        roles: [...implementationSessionRoleNames],
      });
      await storeDependencies.clearQaReports({ repoPath: effectiveRepoPath, taskId });
      await storeDependencies.setPullRequest({
        repoPath: effectiveRepoPath,
        taskId,
        pullRequest: null,
      });
      await storeDependencies.setDirectMerge({
        repoPath: effectiveRepoPath,
        taskId,
        directMerge: null,
      });
      const updated = await taskStore.transitionTask({
        repoPath: effectiveRepoPath,
        taskId,
        status: rollbackStatus,
      });
      return enrichTask(updated, replaceTaskInList(currentTasks, updated));
    } catch (error) {
      throw appendResetCleanupProgress(error, removedWorktrees, deletedBranches);
    }
  },

  async resetTask(input) {
    const record = requireRecord(input, "task_reset input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const dependencies = requireTaskDeleteDependencies(
      devServerService,
      gitPort,
      settingsConfig,
      workspaceSettingsService,
    );
    const storeDependencies = requireTaskResetStoreDependencies(taskStore);
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (!canResetTaskFromStatus(current.status)) {
      throw new Error(
        `Task reset is only allowed from open, spec_ready, ready_for_dev, in_progress, blocked, ai_review, or human_review (current: ${current.status}).`,
      );
    }

    if (taskHasSessionsForRoles(current, taskResetSessionRoles)) {
      if (!taskActivityGuard) {
        throw new Error(
          "task_reset requires runtime session activity checks for tasks with spec, planner, build, or QA sessions.",
        );
      }
      await taskActivityGuard.ensureNoActiveTaskResetActivity({
        repoPath,
        taskId,
        sessions: current.agentSessions ?? [],
        operationLabel: "reset task",
        sessionRoles: [...taskResetSessionRoleNames],
      });
    }

    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const effectiveRepoPath = repoConfig.repoPath;
    const branchPrefix = repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
    const worktreePaths = await collectResetWorktreePaths(
      dependencies,
      effectiveRepoPath,
      branchPrefix,
      current,
      taskResetSessionRoles,
      "reset task",
    );
    const branchNames = await collectRelatedTaskBranches(
      dependencies.gitPort,
      effectiveRepoPath,
      branchPrefix,
      [taskId],
    );
    const removedWorktrees: string[] = [];
    const deletedBranches: string[] = [];
    const completedSteps: string[] = [];

    try {
      await dependencies.devServerService.stop({ repoPath: effectiveRepoPath, taskId });
      for (const worktreePath of worktreePaths) {
        await dependencies.gitPort.removeWorktree(effectiveRepoPath, worktreePath, true);
        removedWorktrees.push(worktreePath);
      }
      for (const branchName of branchNames) {
        await dependencies.gitPort.deleteLocalBranch(effectiveRepoPath, branchName, true);
        deletedBranches.push(branchName);
      }
      await storeDependencies.clearWorkflowDocuments({ repoPath: effectiveRepoPath, taskId });
      completedSteps.push("cleared workflow documents");
      await storeDependencies.clearAgentSessionsByRoles({
        repoPath: effectiveRepoPath,
        taskId,
        roles: [...taskResetSessionRoleNames],
      });
      completedSteps.push("cleared linked agent sessions");
      await storeDependencies.setPullRequest({
        repoPath: effectiveRepoPath,
        taskId,
        pullRequest: null,
      });
      await storeDependencies.setDirectMerge({
        repoPath: effectiveRepoPath,
        taskId,
        directMerge: null,
      });
      completedSteps.push("cleared linked delivery metadata");
      const updated = await taskStore.transitionTask({
        repoPath: effectiveRepoPath,
        taskId,
        status: "open",
      });
      return enrichTask(updated, replaceTaskInList(currentTasks, updated));
    } catch (error) {
      throw appendResetCleanupProgress(error, removedWorktrees, deletedBranches, completedSteps);
    }
  },

  async updateTask(input) {
    const record = requireRecord(input, "task_update input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const patch = parseUpdatePatch(record.patch);
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }
    validateParentRelationshipsForUpdate(currentTasks, current, patch);
    const updated = await taskStore.updateTask({ repoPath, taskId, patch });
    const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

    return enrichTask(updated, nextTasks);
  },

  async transitionTask(input) {
    const record = requireRecord(input, "task_transition input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const status = parseTransitionStatus(record.status);
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }
    validateTransition(current, currentTasks, current.status, status);

    if (current.status === status) {
      return enrichTask(current, currentTasks);
    }

    const updated = await taskStore.transitionTask({ repoPath, taskId, status });
    const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

    return enrichTask(updated, nextTasks);
  },

  async specGet(input) {
    const record = requireRecord(input, "spec_get input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const metadata = await taskStore.getTaskMetadata({ repoPath, taskId });

    return metadata.spec;
  },

  async setSpec(input) {
    const record = requireRecord(input, "set_spec input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const markdown = parseRequiredMarkdown(record.markdown, "spec");
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (!canSetSpecFromStatus(current.status)) {
      throw new Error(
        `set_spec is only allowed from open/spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review (current: ${current.status})`,
      );
    }

    const document = await taskStore.setSpecDocument({ repoPath, taskId, markdown });
    if (current.status === "open") {
      await taskStore.transitionTask({ repoPath, taskId, status: "spec_ready" });
    }

    return document;
  },

  async saveSpecDocument(input) {
    const record = requireRecord(input, "spec_save_document input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const markdown = parseRequiredMarkdown(record.markdown, "spec");
    await taskStore.getTask({ repoPath, taskId });

    return taskStore.setSpecDocument({ repoPath, taskId, markdown });
  },

  async planGet(input) {
    const record = requireRecord(input, "plan_get input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const metadata = await taskStore.getTaskMetadata({ repoPath, taskId });

    return metadata.plan;
  },

  async setPlan(input) {
    const record = requireRecord(input, "set_plan input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const planInput = requireRecord(record.input, "set_plan input.input");
    const markdown = parseRequiredMarkdown(planInput.markdown, "implementation plan");
    const hasExplicitSubtasks = "subtasks" in planInput;
    const subtaskCreates = normalizePlanSubtasks(parsePlanSubtasks(planInput.subtasks));
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (!canSetPlan(current)) {
      throw new Error(
        `set_plan is not allowed for issue type ${current.issueType} from status ${current.status}. feature/epic allow spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review; task/bug also allow open.`,
      );
    }

    const isActiveOrReview = isActiveOrReviewStatus(current.status);
    const shouldValidateSubtaskRules =
      current.issueType !== "epic" || !isActiveOrReview || hasExplicitSubtasks;
    const effectiveSubtaskCreates = current.issueType === "epic" ? subtaskCreates : [];
    if (shouldValidateSubtaskRules) {
      validatePlanSubtaskRules(current, currentTasks, subtaskCreates);
    }

    const shouldReplaceEpicSubtasks = current.issueType === "epic" && hasExplicitSubtasks;
    if (shouldReplaceEpicSubtasks) {
      validateEpicSubtasksReplaceable(current, currentTasks);
    }

    const document = await taskStore.setPlanDocument({ repoPath, taskId, markdown });

    if (shouldReplaceEpicSubtasks) {
      await replaceEpicPlanSubtasks(
        taskStore,
        repoPath,
        current,
        currentTasks,
        effectiveSubtaskCreates,
      );
    }

    if (current.status === "open" || current.status === "spec_ready") {
      await taskStore.transitionTask({ repoPath, taskId, status: "ready_for_dev" });
    }

    return document;
  },

  async savePlanDocument(input) {
    const record = requireRecord(input, "plan_save_document input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const markdown = parseRequiredMarkdown(record.markdown, "implementation plan");
    await taskStore.getTask({ repoPath, taskId });

    return taskStore.setPlanDocument({ repoPath, taskId, markdown });
  },

  async qaGetReport(input) {
    const record = requireRecord(input, "qa_get_report input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const metadata = await taskStore.getTaskMetadata({ repoPath, taskId });

    if (!metadata.qaReport) {
      return { markdown: "" };
    }

    return {
      markdown: metadata.qaReport.markdown,
      ...(metadata.qaReport.updatedAt !== undefined
        ? { updatedAt: metadata.qaReport.updatedAt }
        : {}),
      ...(metadata.qaReport.revision !== undefined ? { revision: metadata.qaReport.revision } : {}),
      ...(metadata.qaReport.error !== undefined ? { error: metadata.qaReport.error } : {}),
    };
  },

  async buildStart(input) {
    const record = requireRecord(input, "build_start input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const runtimeKind = requireString(record.runtimeKind, "runtimeKind");
    const dependencies = requireBuildStartDependencies(
      gitPort,
      runtimeDefinitionsService,
      runtimeRegistry,
      settingsConfig,
      systemCommands,
      worktreeFiles,
      workspaceSettingsService,
    );
    const descriptor = resolveRuntimeDescriptorForBuild(
      dependencies.runtimeDefinitionsService,
      runtimeKind,
    );
    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const canonicalRepoPath = await dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
    if (!(await dependencies.gitPort.isGitRepository(canonicalRepoPath))) {
      throw new Error(`Not a git repository: ${canonicalRepoPath}`);
    }

    const task = await taskStore.getTask({ repoPath: canonicalRepoPath, taskId });
    validateTransition(task, [task], task.status, "in_progress");

    const branch = buildBranchName(repoConfig.branchPrefix, taskId, task.title);
    const targetBranch = await effectiveTargetBranchForTask(
      dependencies.workspaceSettingsService,
      task,
      canonicalRepoPath,
    );
    const worktreeBase = repoConfig.worktreeBasePath
      ? dependencies.settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath)
      : dependencies.settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId);
    const worktreePath = dependencies.settingsConfig.join(worktreeBase, taskId);

    if (await dependencies.settingsConfig.pathExists(worktreePath)) {
      throw new Error(`Worktree path already exists for task ${taskId}: ${worktreePath}`);
    }
    await dependencies.worktreeFiles.ensureDirectory(worktreeBase);

    const startPoint = await resolveBuildStartPoint(
      dependencies,
      canonicalRepoPath,
      targetBranch,
      task.targetBranch === undefined,
    );
    await dependencies.gitPort.createWorktree(
      canonicalRepoPath,
      worktreePath,
      branch,
      true,
      startPoint.reference,
    );

    let createdTrackingRef: string | null = null;
    try {
      if (startPoint.upstreamRemote) {
        const upstreamSetup = await dependencies.gitPort.configureBranchUpstream(
          canonicalRepoPath,
          worktreePath,
          branch,
          startPoint.upstreamRemote,
        );
        createdTrackingRef = upstreamSetup.createdTrackingRef;
      }

      await dependencies.worktreeFiles.copyConfiguredPaths(
        canonicalRepoPath,
        worktreePath,
        repoConfig.worktreeCopyPaths,
      );

      const preStartHooks = repoConfig.hooks.preStart.map((hook) => hook.trim()).filter(Boolean);
      const failure = await runHookCommandsAllowFailure(
        dependencies.systemCommands,
        preStartHooks,
        worktreePath,
      );
      if (failure) {
        throw new Error(`Worktree setup script command failed: ${failure.hook}\n${failure.stderr}`);
      }
    } catch (error) {
      const cleanupError = await rollbackFailedBuildWorktree(
        dependencies,
        canonicalRepoPath,
        worktreePath,
        branch,
        createdTrackingRef,
      );
      if (error instanceof Error) {
        throw new Error(`${error.message}${cleanupError}`, { cause: error });
      }
      throw new Error(`${String(error)}${cleanupError}`);
    }

    const runtime = await dependencies.runtimeRegistry
      .ensureWorkspaceRuntime({
        runtimeKind,
        repoPath: canonicalRepoPath,
        workingDirectory: canonicalRepoPath,
        descriptor,
      })
      .catch((error: unknown) => {
        throw new Error(`${runtimeKind} build runtime failed to start for task ${taskId}`, {
          cause: error,
        });
      });

    await taskStore.transitionTask({ repoPath: canonicalRepoPath, taskId, status: "in_progress" });

    return buildSessionBootstrapSchema.parse({
      runtimeKind,
      runtimeId: runtime.runtimeId,
      workingDirectory: worktreePath,
    });
  },

  async buildBlocked(input) {
    const record = requireRecord(input, "build_blocked input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const reason = typeof record.reason === "string" ? record.reason.trim() : "";
    if (!reason) {
      throw new Error("build_blocked requires a non-empty reason");
    }
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }
    validateTransition(current, currentTasks, current.status, "blocked");

    if (current.status === "blocked") {
      return enrichTask(current, currentTasks);
    }

    const updated = await taskStore.transitionTask({ repoPath, taskId, status: "blocked" });
    const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

    return enrichTask(updated, nextTasks);
  },

  async buildResumed(input) {
    const record = requireRecord(input, "build_resumed input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const current = await taskStore.getTask({ repoPath, taskId });
    validateTransition(current, [current], current.status, "in_progress");

    if (current.status === "in_progress") {
      return enrichTask(current, [current]);
    }

    const updated = await taskStore.transitionTask({ repoPath, taskId, status: "in_progress" });
    return enrichTask(updated, [updated]);
  },

  async buildCompleted(input) {
    const record = requireRecord(input, "build_completed input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const inputRecord =
      record.input === undefined || record.input === null
        ? undefined
        : requireRecord(record.input, "build_completed input.input");
    parseOptionalNote(inputRecord?.summary, "build_completed summary");
    const dependencies = requireBuildCompletedDependencies(
      settingsConfig,
      systemCommands,
      workspaceSettingsService,
    );
    const { current, currentTasks } = await taskListWithCurrent(taskStore, repoPath, taskId);

    if (current.status === "ai_review" || current.status === "human_review") {
      return enrichTask(current, currentTasks);
    }
    if (current.status !== "in_progress" && current.status !== "blocked") {
      throw new Error(
        `build_completed is only allowed from in_progress, blocked, ai_review, or human_review. Task ${current.id} is ${current.status}.`,
      );
    }

    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const nextStatus =
      current.aiReviewEnabled && current.documentSummary.qaReport.verdict !== "approved"
        ? "ai_review"
        : "human_review";
    validateTransition(current, currentTasks, current.status, nextStatus);

    const postCompleteHooks = repoConfig.hooks.postComplete
      .map((hook) => hook.trim())
      .filter(Boolean);
    if (postCompleteHooks.length > 0) {
      let worktreePath: string;
      try {
        worktreePath = await buildCompletionWorktreePath(
          dependencies.settingsConfig,
          repoConfig,
          taskId,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await blockBuildCompletionTask(taskStore, repoPath, taskId, current, currentTasks);
        throw new Error(message, { cause: error });
      }

      const failure = await runHookCommandsAllowFailure(
        dependencies.systemCommands,
        postCompleteHooks,
        worktreePath,
      );
      if (failure !== null) {
        const message = `Worktree cleanup script command failed: ${failure.hook}\n${failure.stderr}`;
        await blockBuildCompletionTask(taskStore, repoPath, taskId, current, currentTasks);
        throw new Error(message);
      }
    }

    const updated = await taskStore.transitionTask({ repoPath, taskId, status: nextStatus });
    const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

    return enrichTask(updated, nextTasks);
  },

  async qaApproved(input) {
    const record = requireRecord(input, "qa_approved input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const markdown = parseRequiredMarkdown(record.reportMarkdown, "QA report");

    return recordQaOutcome(taskStore, {
      repoPath,
      taskId,
      markdown,
      verdict: "approved",
      targetStatus: "human_review",
    });
  },

  async qaRejected(input) {
    const record = requireRecord(input, "qa_rejected input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const markdown = parseRequiredMarkdown(record.reportMarkdown, "QA report");

    return recordQaOutcome(taskStore, {
      repoPath,
      taskId,
      markdown,
      verdict: "rejected",
      targetStatus: "in_progress",
    });
  },

  async humanRequestChanges(input) {
    const record = requireRecord(input, "human_request_changes input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    parseOptionalNote(record.note, "human_request_changes note");
    const metadata = await taskStore.getTaskMetadata({ repoPath, taskId });
    if (metadata.directMerge !== undefined) {
      throw new Error(
        `Cannot request changes after a local direct merge has already been applied for task ${taskId}. Push and complete the direct merge workflow first, or manually revert the local merge before reopening the task.`,
      );
    }

    const current = await taskStore.getTask({ repoPath, taskId });
    validateTransition(current, [current], current.status, "in_progress");

    if (current.status === "in_progress") {
      return enrichTask(current, [current]);
    }

    const updated = await taskStore.transitionTask({ repoPath, taskId, status: "in_progress" });
    return enrichTask(updated, [updated]);
  },

  async humanApprove(input) {
    const record = requireRecord(input, "human_approve input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const { current, currentTasks } = await taskListWithCurrent(taskStore, repoPath, taskId);
    validateTransition(current, currentTasks, current.status, "closed");

    if (current.status === "closed") {
      return enrichTask(current, currentTasks);
    }

    const updated = await taskStore.transitionTask({ repoPath, taskId, status: "closed" });
    const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

    return enrichTask(updated, nextTasks);
  },

  async repoPullRequestSync(input) {
    const result = await this.repoPullRequestSyncDetailed(input);
    return { ok: result.ran };
  },

  async repoPullRequestSyncDetailed(input) {
    const record = requireRecord(input, "repo_pull_request_sync input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const dependencies = requirePullRequestSyncDependencies(
      systemCommands,
      workspaceSettingsService,
    );
    if (!taskStore.listPullRequestSyncCandidates) {
      throw new Error("Task store port is required to support repo_pull_request_sync.");
    }
    if (!taskStore.setPullRequest) {
      throw new Error("Task store port is required to persist repo_pull_request_sync results.");
    }

    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const effectiveRepoPath = repoConfig.repoPath;
    const policy = await githubPullRequestSyncPolicy(dependencies.systemCommands, repoConfig);
    if (!policy.available) {
      return { ran: false, changedTaskIds: [] };
    }

    const tasks = await taskStore.listPullRequestSyncCandidates({ repoPath: effectiveRepoPath });
    const changedTaskIds: string[] = [];
    for (const task of tasks) {
      const pullRequest = task.pullRequest;
      if (!pullRequest) {
        continue;
      }

      const updated = await fetchLinkedPullRequest(
        dependencies,
        effectiveRepoPath,
        policy,
        pullRequest,
      );
      if (!updated) {
        continue;
      }

      if (updated.record.state === "merged" && task.status !== "closed") {
        const cleanupDependencies = requirePullRequestMergeCleanupDependencies(
          devServerService,
          gitPort,
          settingsConfig,
          taskWorktreeService,
        );
        await taskStore.setPullRequest({
          repoPath: effectiveRepoPath,
          taskId: task.id,
          pullRequest: updated.record,
        });
        await cleanupMergedBuilderState(
          cleanupDependencies,
          taskStore,
          effectiveRepoPath,
          task.id,
          updated.sourceBranch,
          updated.targetBranch,
        );

        const { current, currentTasks } = await taskListWithCurrent(
          taskStore,
          effectiveRepoPath,
          task.id,
        );
        validateTransition(current, currentTasks, current.status, "closed");
        await taskStore.transitionTask({
          repoPath: effectiveRepoPath,
          taskId: task.id,
          status: "closed",
        });
        changedTaskIds.push(task.id);
      } else if (!pullRequestRecordsMatch(updated.record, pullRequest)) {
        await taskStore.setPullRequest({
          repoPath: effectiveRepoPath,
          taskId: task.id,
          pullRequest: updated.record,
        });
        changedTaskIds.push(task.id);
      }
    }

    return { ran: true, changedTaskIds };
  },

  async deferTask(input) {
    const record = requireRecord(input, "task_defer input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (current.parentId !== undefined) {
      throw new Error("Subtasks cannot be deferred.");
    }
    if (!isDeferrableOpenState(current.status)) {
      throw new Error("Only non-closed open-state tasks can be deferred.");
    }
    validateTransition(current, currentTasks, current.status, "deferred");

    const updated = await taskStore.transitionTask({ repoPath, taskId, status: "deferred" });
    const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

    return enrichTask(updated, nextTasks);
  },

  async resumeDeferredTask(input) {
    const record = requireRecord(input, "task_resume_deferred input");
    const repoPath = requireString(record.repoPath, "repoPath");
    const taskId = requireString(record.taskId, "taskId");
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (current.status !== "deferred") {
      throw new Error(`Task is not deferred: ${taskId}`);
    }
    validateTransition(current, currentTasks, current.status, "open");

    const updated = await taskStore.transitionTask({ repoPath, taskId, status: "open" });
    const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

    return enrichTask(updated, nextTasks);
  },
});
