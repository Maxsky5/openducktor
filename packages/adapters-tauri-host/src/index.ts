import type {
  AgentRuntimeSummary,
  AgentSessionRecord,
  BeadsCheck,
  GitBranch,
  GitCurrentBranch,
  GitPushSummary,
  GitWorktreeSummary,
  RepoConfig,
  RunSummary,
  RuntimeCheck,
  SystemCheck,
  TaskCard,
  TaskCreateInput,
  TaskStatus,
  TaskUpdatePatch,
  WorkspaceRecord,
} from "@openducktor/contracts";
import type { PlannerTools, SetPlanOutput, SetSpecOutput } from "@openducktor/core";
import {
  beadsCheck,
  buildBlocked,
  buildCleanup,
  buildCompleted,
  buildRespond,
  buildResumed,
  buildStart,
  buildStop,
  humanApprove,
  humanRequestChanges,
  opencodeRepoRuntimeEnsure,
  opencodeRuntimeList,
  opencodeRuntimeStart,
  opencodeRuntimeStop,
  runsList,
  runtimeCheck,
  systemCheck,
} from "./build-runtime-client";
import {
  gitCreateWorktree,
  gitGetBranches,
  gitGetCurrentBranch,
  gitPushBranch,
  gitRemoveWorktree,
  gitSwitchBranch,
} from "./git-client";
import type { InvokeFn } from "./invoke-utils";
import {
  agentSessionsList,
  agentSessionUpsert,
  planGet,
  qaApproved,
  qaGetReport,
  qaRejected,
  savePlanDocument,
  saveSpecDocument,
  setPlan,
  setSpec,
  specGet,
  taskCreate,
  taskDefer,
  taskDelete,
  taskResumeDeferred,
  tasksList,
  taskTransition,
  taskUpdate,
} from "./task-client";
import { TaskMetadataCache } from "./task-metadata-cache";
import {
  getTheme,
  setTheme,
  workspaceAdd,
  workspaceGetRepoConfig,
  workspaceList,
  workspacePrepareTrustedHooksChallenge,
  workspaceSelect,
  workspaceSetTrustedHooks,
  workspaceUpdateRepoConfig,
  workspaceUpdateRepoHooks,
} from "./workspace-client";

export class TauriHostClient implements PlannerTools {
  private readonly taskMetadataCache = new TaskMetadataCache();

  constructor(private readonly invokeFn: InvokeFn) {}

  async workspaceList(): Promise<WorkspaceRecord[]> {
    return workspaceList(this.invokeFn);
  }

  async workspaceAdd(repoPath: string): Promise<WorkspaceRecord> {
    return workspaceAdd(this.invokeFn, repoPath);
  }

  async workspaceSelect(repoPath: string): Promise<WorkspaceRecord> {
    return workspaceSelect(this.invokeFn, repoPath);
  }

  async systemCheck(repoPath: string): Promise<SystemCheck> {
    return systemCheck(this.invokeFn, repoPath);
  }

  async runtimeCheck(force = false): Promise<RuntimeCheck> {
    return runtimeCheck(this.invokeFn, force);
  }

  async beadsCheck(repoPath: string): Promise<BeadsCheck> {
    return beadsCheck(this.invokeFn, repoPath);
  }

  async tasksList(repoPath: string): Promise<TaskCard[]> {
    return tasksList(this.invokeFn, repoPath);
  }

  async taskCreate(repoPath: string, input: TaskCreateInput): Promise<TaskCard> {
    return taskCreate(this.invokeFn, repoPath, input);
  }

  async taskUpdate(repoPath: string, taskId: string, patch: TaskUpdatePatch): Promise<TaskCard> {
    return taskUpdate(this.invokeFn, repoPath, taskId, patch);
  }

  async taskDelete(
    repoPath: string,
    taskId: string,
    deleteSubtasks = false,
  ): Promise<{ ok: boolean }> {
    return taskDelete(this.invokeFn, this.taskMetadataCache, repoPath, taskId, deleteSubtasks);
  }

  async taskTransition(
    repoPath: string,
    taskId: string,
    status: TaskStatus,
    reason?: string,
  ): Promise<TaskCard> {
    return taskTransition(this.invokeFn, repoPath, taskId, status, reason);
  }

  async taskDefer(repoPath: string, taskId: string, reason?: string): Promise<TaskCard> {
    return taskDefer(this.invokeFn, repoPath, taskId, reason);
  }

  async taskResumeDeferred(repoPath: string, taskId: string): Promise<TaskCard> {
    return taskResumeDeferred(this.invokeFn, repoPath, taskId);
  }

  async specGet(
    repoPath: string,
    taskId: string,
  ): Promise<{ markdown: string; updatedAt: string | null }> {
    return specGet(this.taskMetadataCache, this.invokeFn, repoPath, taskId);
  }

  async setSpec(input: {
    taskId: string;
    markdown: string;
    repoPath?: string;
  }): Promise<SetSpecOutput> {
    return setSpec(this.invokeFn, this.taskMetadataCache, input);
  }

  async saveSpecDocument(
    repoPath: string,
    taskId: string,
    markdown: string,
  ): Promise<SetSpecOutput> {
    return saveSpecDocument(this.invokeFn, this.taskMetadataCache, repoPath, taskId, markdown);
  }

  async setPlan(input: {
    taskId: string;
    markdown: string;
    subtasks?: Array<{
      title: string;
      issueType?: "task" | "feature" | "bug";
      priority?: number;
      description?: string;
    }>;
    repoPath?: string;
  }): Promise<SetPlanOutput> {
    return setPlan(this.invokeFn, this.taskMetadataCache, input);
  }

  async savePlanDocument(
    repoPath: string,
    taskId: string,
    markdown: string,
  ): Promise<SetPlanOutput> {
    return savePlanDocument(this.invokeFn, this.taskMetadataCache, repoPath, taskId, markdown);
  }

  async planGet(
    repoPath: string,
    taskId: string,
  ): Promise<{ markdown: string; updatedAt: string | null }> {
    return planGet(this.taskMetadataCache, this.invokeFn, repoPath, taskId);
  }

  async qaGetReport(
    repoPath: string,
    taskId: string,
  ): Promise<{ markdown: string; updatedAt: string | null }> {
    return qaGetReport(this.taskMetadataCache, this.invokeFn, repoPath, taskId);
  }

  async qaApproved(repoPath: string, taskId: string, markdown: string): Promise<TaskCard> {
    return qaApproved(this.invokeFn, this.taskMetadataCache, repoPath, taskId, markdown);
  }

  async qaRejected(repoPath: string, taskId: string, markdown: string): Promise<TaskCard> {
    return qaRejected(this.invokeFn, this.taskMetadataCache, repoPath, taskId, markdown);
  }

  async runsList(repoPath?: string): Promise<RunSummary[]> {
    return runsList(this.invokeFn, repoPath);
  }

  async opencodeRuntimeList(repoPath?: string): Promise<AgentRuntimeSummary[]> {
    return opencodeRuntimeList(this.invokeFn, repoPath);
  }

  async opencodeRuntimeStart(
    repoPath: string,
    taskId: string,
    role: "spec" | "planner" | "qa",
  ): Promise<AgentRuntimeSummary> {
    return opencodeRuntimeStart(this.invokeFn, repoPath, taskId, role);
  }

  async opencodeRuntimeStop(runtimeId: string): Promise<{ ok: boolean }> {
    return opencodeRuntimeStop(this.invokeFn, runtimeId);
  }

  async opencodeRepoRuntimeEnsure(repoPath: string): Promise<AgentRuntimeSummary> {
    return opencodeRepoRuntimeEnsure(this.invokeFn, repoPath);
  }

  async agentSessionsList(repoPath: string, taskId: string): Promise<AgentSessionRecord[]> {
    return agentSessionsList(this.taskMetadataCache, this.invokeFn, repoPath, taskId);
  }

  async agentSessionUpsert(
    repoPath: string,
    taskId: string,
    session: AgentSessionRecord,
  ): Promise<void> {
    return agentSessionUpsert(this.invokeFn, this.taskMetadataCache, repoPath, taskId, session);
  }

  async workspaceUpdateRepoConfig(
    repoPath: string,
    config: {
      worktreeBasePath?: string;
      branchPrefix?: string;
      agentDefaults?: {
        spec?: { providerId: string; modelId: string; variant?: string; opencodeAgent?: string };
        planner?: { providerId: string; modelId: string; variant?: string; opencodeAgent?: string };
        build?: { providerId: string; modelId: string; variant?: string; opencodeAgent?: string };
        qa?: { providerId: string; modelId: string; variant?: string; opencodeAgent?: string };
      };
    },
  ): Promise<WorkspaceRecord> {
    return workspaceUpdateRepoConfig(this.invokeFn, repoPath, config);
  }

  async workspaceUpdateRepoHooks(
    repoPath: string,
    hooks: { preStart?: string[]; postComplete?: string[] },
  ): Promise<WorkspaceRecord> {
    return workspaceUpdateRepoHooks(this.invokeFn, repoPath, hooks);
  }

  async workspaceGetRepoConfig(repoPath: string): Promise<RepoConfig> {
    return workspaceGetRepoConfig(this.invokeFn, repoPath);
  }

  async workspacePrepareTrustedHooksChallenge(repoPath: string): Promise<{
    nonce: string;
    repoPath: string;
    fingerprint: string;
    expiresAt: string;
    preStartCount: number;
    postCompleteCount: number;
  }> {
    return workspacePrepareTrustedHooksChallenge(this.invokeFn, repoPath);
  }

  async workspaceSetTrustedHooks(
    repoPath: string,
    trusted: boolean,
    challenge?: { nonce: string; fingerprint: string },
  ): Promise<WorkspaceRecord> {
    return workspaceSetTrustedHooks(this.invokeFn, repoPath, trusted, challenge);
  }

  async getTheme(): Promise<string> {
    return getTheme(this.invokeFn);
  }

  async setTheme(theme: string): Promise<void> {
    return setTheme(this.invokeFn, theme);
  }

  async gitGetBranches(repoPath: string): Promise<GitBranch[]> {
    return gitGetBranches(this.invokeFn, repoPath);
  }

  async gitGetCurrentBranch(repoPath: string): Promise<GitCurrentBranch> {
    return gitGetCurrentBranch(this.invokeFn, repoPath);
  }

  async gitSwitchBranch(
    repoPath: string,
    branch: string,
    options?: { create?: boolean },
  ): Promise<GitCurrentBranch> {
    return gitSwitchBranch(this.invokeFn, repoPath, branch, options);
  }

  async gitCreateWorktree(
    repoPath: string,
    worktreePath: string,
    branch: string,
    options?: { createBranch?: boolean },
  ): Promise<GitWorktreeSummary> {
    return gitCreateWorktree(this.invokeFn, repoPath, worktreePath, branch, options);
  }

  async gitRemoveWorktree(
    repoPath: string,
    worktreePath: string,
    options?: { force?: boolean },
  ): Promise<{ ok: boolean }> {
    return gitRemoveWorktree(this.invokeFn, repoPath, worktreePath, options);
  }

  async gitPushBranch(
    repoPath: string,
    branch: string,
    options?: {
      remote?: string;
      setUpstream?: boolean;
      forceWithLease?: boolean;
    },
  ): Promise<GitPushSummary> {
    return gitPushBranch(this.invokeFn, repoPath, branch, options);
  }

  async buildStart(repoPath: string, taskId: string): Promise<RunSummary> {
    return buildStart(this.invokeFn, repoPath, taskId);
  }

  async buildBlocked(repoPath: string, taskId: string, reason: string): Promise<TaskCard> {
    return buildBlocked(this.invokeFn, repoPath, taskId, reason);
  }

  async buildResumed(repoPath: string, taskId: string): Promise<TaskCard> {
    return buildResumed(this.invokeFn, repoPath, taskId);
  }

  async buildCompleted(repoPath: string, taskId: string, summary?: string): Promise<TaskCard> {
    return buildCompleted(this.invokeFn, repoPath, taskId, summary);
  }

  async humanRequestChanges(repoPath: string, taskId: string, note?: string): Promise<TaskCard> {
    return humanRequestChanges(this.invokeFn, repoPath, taskId, note);
  }

  async humanApprove(repoPath: string, taskId: string): Promise<TaskCard> {
    return humanApprove(this.invokeFn, repoPath, taskId);
  }

  async buildRespond(
    runId: string,
    action: "approve" | "deny" | "message",
    payload?: string,
  ): Promise<{ ok: boolean }> {
    return buildRespond(this.invokeFn, runId, action, payload);
  }

  async buildStop(runId: string): Promise<{ ok: boolean }> {
    return buildStop(this.invokeFn, runId);
  }

  async buildCleanup(runId: string, mode: "success" | "failure"): Promise<{ ok: boolean }> {
    return buildCleanup(this.invokeFn, runId, mode);
  }
}
