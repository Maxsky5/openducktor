import {
  type BeadsCheck,
  type RepoConfig,
  type RunSummary,
  type RuntimeCheck,
  type SystemCheck,
  type TaskCard,
  type TaskPhase,
  type WorkspaceRecord,
  beadsCheckSchema,
  repoConfigSchema,
  runSummarySchema,
  runtimeCheckSchema,
  systemCheckSchema,
  taskCardSchema,
  taskPhaseSchema,
  workspaceRecordSchema,
} from "@openblueprint/contracts";
import type { PlannerTools, SetSpecMarkdownOutput } from "@openblueprint/core";

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

  async taskCreate(repoPath: string, title: string): Promise<TaskCard> {
    const payload = await this.invokeFn<unknown>("task_create", {
      repoPath,
      input: { title },
    });
    return taskCardSchema.parse(payload);
  }

  async taskUpdate(
    repoPath: string,
    taskId: string,
    patch: {
      title?: string;
      description?: string;
      status?: "open" | "in_progress" | "blocked" | "closed";
    },
  ): Promise<TaskCard> {
    const payload = await this.invokeFn<unknown>("task_update", {
      repoPath,
      taskId,
      patch,
    });
    return taskCardSchema.parse(payload);
  }

  async taskSetPhase(
    repoPath: string,
    taskId: string,
    phase: TaskPhase,
    reason?: string,
  ): Promise<TaskCard> {
    taskPhaseSchema.parse(phase);
    const payload = await this.invokeFn<unknown>("task_set_phase", {
      repoPath,
      taskId,
      phase,
      reason,
    });
    return taskCardSchema.parse(payload);
  }

  async specGet(
    repoPath: string,
    taskId: string,
  ): Promise<{ markdown: string; updatedAt: string }> {
    const payload = await this.invokeFn<{ markdown: string; updatedAt: string }>("spec_get", {
      repoPath,
      taskId,
    });

    return {
      markdown: payload.markdown,
      updatedAt: payload.updatedAt,
    };
  }

  async setSpecMarkdown(input: {
    taskId: string;
    markdown: string;
    repoPath?: string;
  }): Promise<SetSpecMarkdownOutput> {
    if (!input.repoPath) {
      throw new Error("repoPath is required to set spec markdown");
    }

    const payload = await this.invokeFn<{ updatedAt: string }>("spec_set_markdown", {
      repoPath: input.repoPath,
      taskId: input.taskId,
      markdown: input.markdown,
    });

    return { updatedAt: payload.updatedAt };
  }

  async runsList(repoPath?: string): Promise<RunSummary[]> {
    const payload = await this.invokeFn<unknown>("runs_list", { repoPath });
    return parseArray(runSummarySchema, payload);
  }

  async workspaceUpdateRepoConfig(
    repoPath: string,
    config: {
      worktreeBasePath?: string;
      branchPrefix?: string;
      trustedHooks?: boolean;
      hooks?: { preStart?: string[]; postComplete?: string[] };
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

  async delegateStart(repoPath: string, taskId: string): Promise<RunSummary> {
    const payload = await this.invokeFn<unknown>("delegate_start", { repoPath, taskId });
    return runSummarySchema.parse(payload);
  }

  async delegateRespond(
    runId: string,
    action: "approve" | "deny" | "message",
    payload?: string,
  ): Promise<{ ok: boolean }> {
    return this.invokeFn<{ ok: boolean }>("delegate_respond", { runId, action, payload });
  }

  async delegateStop(runId: string): Promise<{ ok: boolean }> {
    return this.invokeFn<{ ok: boolean }>("delegate_stop", { runId });
  }

  async delegateCleanup(runId: string, mode: "success" | "failure"): Promise<{ ok: boolean }> {
    return this.invokeFn<{ ok: boolean }>("delegate_cleanup", { runId, mode });
  }
}
