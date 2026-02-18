import {
  type AgentRuntimeSummary,
  type AgentSessionRecord,
  type BeadsCheck,
  type RepoConfig,
  type RunSummary,
  type RuntimeCheck,
  type SystemCheck,
  type TaskCard,
  type TaskCreateInput,
  type TaskStatus,
  type TaskUpdatePatch,
  type WorkspaceRecord,
  agentRuntimeSummarySchema,
  agentSessionRecordSchema,
  beadsCheckSchema,
  repoConfigSchema,
  runSummarySchema,
  runtimeCheckSchema,
  systemCheckSchema,
  taskCardSchema,
  taskCreateInputSchema,
  taskStatusSchema,
  taskUpdatePatchSchema,
  workspaceRecordSchema,
} from "@openblueprint/contracts";
import type { PlannerTools, SetPlanOutput, SetSpecOutput } from "@openblueprint/core";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

const parseArray = <T>(schema: { parse: (value: unknown) => T }, payload: unknown): T[] => {
  if (!Array.isArray(payload)) {
    throw new Error("Expected array payload from host command");
  }
  return payload.map((entry) => schema.parse(entry));
};

export class TauriHostClient implements PlannerTools {
  constructor(private readonly invokeFn: InvokeFn) {}

  async workspaceList(): Promise<WorkspaceRecord[]> {
    const payload = await this.invokeFn<unknown>("workspace_list");
    return parseArray(workspaceRecordSchema, payload);
  }

  async workspaceAdd(repoPath: string): Promise<WorkspaceRecord> {
    const payload = await this.invokeFn<unknown>("workspace_add", { repoPath });
    return workspaceRecordSchema.parse(payload);
  }

  async workspaceSelect(repoPath: string): Promise<WorkspaceRecord> {
    const payload = await this.invokeFn<unknown>("workspace_select", { repoPath });
    return workspaceRecordSchema.parse(payload);
  }

  async systemCheck(repoPath: string): Promise<SystemCheck> {
    const payload = await this.invokeFn<unknown>("system_check", { repoPath });
    return systemCheckSchema.parse(payload);
  }

  async runtimeCheck(): Promise<RuntimeCheck> {
    const payload = await this.invokeFn<unknown>("runtime_check");
    return runtimeCheckSchema.parse(payload);
  }

  async beadsCheck(repoPath: string): Promise<BeadsCheck> {
    const payload = await this.invokeFn<unknown>("beads_check", { repoPath });
    return beadsCheckSchema.parse(payload);
  }

  async tasksList(repoPath: string): Promise<TaskCard[]> {
    const payload = await this.invokeFn<unknown>("tasks_list", { repoPath });
    return parseArray(taskCardSchema, payload);
  }

  async taskCreate(repoPath: string, input: TaskCreateInput): Promise<TaskCard> {
    const createInput = taskCreateInputSchema.parse(input);
    const payload = await this.invokeFn<unknown>("task_create", {
      repoPath,
      input: createInput,
    });
    return taskCardSchema.parse(payload);
  }

  async taskUpdate(repoPath: string, taskId: string, patch: TaskUpdatePatch): Promise<TaskCard> {
    const updatePatch = taskUpdatePatchSchema.parse(patch);
    const payload = await this.invokeFn<unknown>("task_update", {
      repoPath,
      taskId,
      patch: updatePatch,
    });
    return taskCardSchema.parse(payload);
  }

  async taskTransition(
    repoPath: string,
    taskId: string,
    status: TaskStatus,
    reason?: string,
  ): Promise<TaskCard> {
    taskStatusSchema.parse(status);
    const payload = await this.invokeFn<unknown>("task_transition", {
      repoPath,
      taskId,
      status,
      reason,
    });
    return taskCardSchema.parse(payload);
  }

  async taskDefer(repoPath: string, taskId: string, reason?: string): Promise<TaskCard> {
    const payload = await this.invokeFn<unknown>("task_defer", {
      repoPath,
      taskId,
      reason,
    });
    return taskCardSchema.parse(payload);
  }

  async taskResumeDeferred(repoPath: string, taskId: string): Promise<TaskCard> {
    const payload = await this.invokeFn<unknown>("task_resume_deferred", {
      repoPath,
      taskId,
    });
    return taskCardSchema.parse(payload);
  }

  async specGet(
    repoPath: string,
    taskId: string,
  ): Promise<{ markdown: string; updatedAt: string | null }> {
    const payload = await this.invokeFn<{ markdown: string; updatedAt?: string | null }>(
      "spec_get",
      {
        repoPath,
        taskId,
      },
    );

    return {
      markdown: payload.markdown,
      updatedAt: payload.updatedAt ?? null,
    };
  }

  async setSpec(input: {
    taskId: string;
    markdown: string;
    repoPath?: string;
  }): Promise<SetSpecOutput> {
    if (!input.repoPath) {
      throw new Error("repoPath is required to set spec");
    }

    const payload = await this.invokeFn<{ updatedAt: string }>("set_spec", {
      repoPath: input.repoPath,
      taskId: input.taskId,
      markdown: input.markdown,
    });

    return { updatedAt: payload.updatedAt };
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
    if (!input.repoPath) {
      throw new Error("repoPath is required to set plan");
    }

    const payload = await this.invokeFn<{ updatedAt: string }>("set_plan", {
      repoPath: input.repoPath,
      taskId: input.taskId,
      input: {
        markdown: input.markdown,
        subtasks: input.subtasks,
      },
    });

    return { updatedAt: payload.updatedAt };
  }

  async planGet(
    repoPath: string,
    taskId: string,
  ): Promise<{ markdown: string; updatedAt: string | null }> {
    const payload = await this.invokeFn<{ markdown: string; updatedAt?: string | null }>(
      "plan_get",
      {
        repoPath,
        taskId,
      },
    );
    return {
      markdown: payload.markdown,
      updatedAt: payload.updatedAt ?? null,
    };
  }

  async qaGetReport(
    repoPath: string,
    taskId: string,
  ): Promise<{ markdown: string; updatedAt: string | null }> {
    const payload = await this.invokeFn<{ markdown: string; updatedAt?: string | null }>(
      "qa_get_report",
      {
        repoPath,
        taskId,
      },
    );
    return {
      markdown: payload.markdown,
      updatedAt: payload.updatedAt ?? null,
    };
  }

  async qaApproved(repoPath: string, taskId: string, markdown: string): Promise<TaskCard> {
    const payload = await this.invokeFn<unknown>("qa_approved", {
      repoPath,
      taskId,
      input: { markdown },
    });
    return taskCardSchema.parse(payload);
  }

  async qaRejected(repoPath: string, taskId: string, markdown: string): Promise<TaskCard> {
    const payload = await this.invokeFn<unknown>("qa_rejected", {
      repoPath,
      taskId,
      input: { markdown },
    });
    return taskCardSchema.parse(payload);
  }

  async runsList(repoPath?: string): Promise<RunSummary[]> {
    const payload = await this.invokeFn<unknown>("runs_list", { repoPath });
    return parseArray(runSummarySchema, payload);
  }

  async opencodeRuntimeList(repoPath?: string): Promise<AgentRuntimeSummary[]> {
    const payload = await this.invokeFn<unknown>("opencode_runtime_list", { repoPath });
    return parseArray(agentRuntimeSummarySchema, payload);
  }

  async opencodeRuntimeStart(
    repoPath: string,
    taskId: string,
    role: "spec" | "planner" | "qa",
  ): Promise<AgentRuntimeSummary> {
    const payload = await this.invokeFn<unknown>("opencode_runtime_start", {
      repoPath,
      taskId,
      role,
    });
    return agentRuntimeSummarySchema.parse(payload);
  }

  async opencodeRuntimeStop(runtimeId: string): Promise<{ ok: boolean }> {
    return this.invokeFn<{ ok: boolean }>("opencode_runtime_stop", {
      runtimeId,
    });
  }

  async opencodeRepoRuntimeEnsure(repoPath: string): Promise<AgentRuntimeSummary> {
    const payload = await this.invokeFn<unknown>("opencode_repo_runtime_ensure", {
      repoPath,
    });
    return agentRuntimeSummarySchema.parse(payload);
  }

  async agentSessionsList(repoPath: string, taskId: string): Promise<AgentSessionRecord[]> {
    const payload = await this.invokeFn<unknown>("agent_sessions_list", {
      repoPath,
      taskId,
    });
    return parseArray(agentSessionRecordSchema, payload);
  }

  async agentSessionUpsert(
    repoPath: string,
    taskId: string,
    session: AgentSessionRecord,
  ): Promise<void> {
    await this.invokeFn<unknown>("agent_session_upsert", {
      repoPath,
      taskId,
      session,
    });
  }

  async workspaceUpdateRepoConfig(
    repoPath: string,
    config: {
      worktreeBasePath?: string;
      branchPrefix?: string;
      trustedHooks?: boolean;
      hooks?: { preStart?: string[]; postComplete?: string[] };
      agentDefaults?: {
        spec?: { providerId: string; modelId: string; variant?: string; opencodeAgent?: string };
        planner?: { providerId: string; modelId: string; variant?: string; opencodeAgent?: string };
        build?: { providerId: string; modelId: string; variant?: string; opencodeAgent?: string };
        qa?: { providerId: string; modelId: string; variant?: string; opencodeAgent?: string };
      };
    },
  ): Promise<WorkspaceRecord> {
    const payload = await this.invokeFn<unknown>("workspace_update_repo_config", {
      repoPath,
      config,
    });
    return workspaceRecordSchema.parse(payload);
  }

  async workspaceGetRepoConfig(repoPath: string): Promise<RepoConfig> {
    const payload = await this.invokeFn<unknown>("workspace_get_repo_config", { repoPath });
    return repoConfigSchema.parse(payload);
  }

  async workspaceSetTrustedHooks(repoPath: string, trusted: boolean): Promise<WorkspaceRecord> {
    const payload = await this.invokeFn<unknown>("workspace_set_trusted_hooks", {
      repoPath,
      trusted,
    });
    return workspaceRecordSchema.parse(payload);
  }

  async buildStart(repoPath: string, taskId: string): Promise<RunSummary> {
    const payload = await this.invokeFn<unknown>("build_start", { repoPath, taskId });
    return runSummarySchema.parse(payload);
  }

  async buildBlocked(repoPath: string, taskId: string, reason: string): Promise<TaskCard> {
    const payload = await this.invokeFn<unknown>("build_blocked", {
      repoPath,
      taskId,
      reason,
    });
    return taskCardSchema.parse(payload);
  }

  async buildResumed(repoPath: string, taskId: string): Promise<TaskCard> {
    const payload = await this.invokeFn<unknown>("build_resumed", {
      repoPath,
      taskId,
    });
    return taskCardSchema.parse(payload);
  }

  async buildCompleted(repoPath: string, taskId: string, summary?: string): Promise<TaskCard> {
    const payload = await this.invokeFn<unknown>("build_completed", {
      repoPath,
      taskId,
      input: { summary },
    });
    return taskCardSchema.parse(payload);
  }

  async humanRequestChanges(repoPath: string, taskId: string, note?: string): Promise<TaskCard> {
    const payload = await this.invokeFn<unknown>("human_request_changes", {
      repoPath,
      taskId,
      note,
    });
    return taskCardSchema.parse(payload);
  }

  async humanApprove(repoPath: string, taskId: string): Promise<TaskCard> {
    const payload = await this.invokeFn<unknown>("human_approve", {
      repoPath,
      taskId,
    });
    return taskCardSchema.parse(payload);
  }

  async buildRespond(
    runId: string,
    action: "approve" | "deny" | "message",
    payload?: string,
  ): Promise<{ ok: boolean }> {
    return this.invokeFn<{ ok: boolean }>("build_respond", { runId, action, payload });
  }

  async buildStop(runId: string): Promise<{ ok: boolean }> {
    return this.invokeFn<{ ok: boolean }>("build_stop", { runId });
  }

  async buildCleanup(runId: string, mode: "success" | "failure"): Promise<{ ok: boolean }> {
    return this.invokeFn<{ ok: boolean }>("build_cleanup", { runId, mode });
  }
}
