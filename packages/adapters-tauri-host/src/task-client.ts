import {
  type AgentSessionRecord,
  type TaskCard,
  type TaskCreateInput,
  type TaskStatus,
  type TaskUpdatePatch,
  taskCardSchema,
  taskCreateInputSchema,
  taskStatusSchema,
  taskUpdatePatchSchema,
} from "@openducktor/contracts";
import type { SetPlanOutput, SetSpecOutput } from "@openducktor/core";
import type { InvokeFn } from "./invoke-utils";
import { parseArray } from "./invoke-utils";
import type { TaskMetadataCache } from "./task-metadata-cache";

export type SetSpecInput = {
  taskId: string;
  markdown: string;
  repoPath?: string;
};

export type PlanSubtaskInput = {
  title: string;
  issueType?: "task" | "feature" | "bug";
  priority?: number;
  description?: string;
};

export type SetPlanInput = {
  taskId: string;
  markdown: string;
  subtasks?: PlanSubtaskInput[];
  repoPath?: string;
};

export const tasksList = async (invokeFn: InvokeFn, repoPath: string): Promise<TaskCard[]> => {
  const payload = await invokeFn<unknown>("tasks_list", { repoPath });
  return parseArray(taskCardSchema, payload);
};

export const taskCreate = async (
  invokeFn: InvokeFn,
  repoPath: string,
  input: TaskCreateInput,
): Promise<TaskCard> => {
  const createInput = taskCreateInputSchema.parse(input);
  const payload = await invokeFn<unknown>("task_create", {
    repoPath,
    input: createInput,
  });
  return taskCardSchema.parse(payload);
};

export const taskUpdate = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  patch: TaskUpdatePatch,
): Promise<TaskCard> => {
  const updatePatch = taskUpdatePatchSchema.parse(patch);
  const payload = await invokeFn<unknown>("task_update", {
    repoPath,
    taskId,
    patch: updatePatch,
  });
  return taskCardSchema.parse(payload);
};

export const taskDelete = async (
  invokeFn: InvokeFn,
  metadataCache: TaskMetadataCache,
  repoPath: string,
  taskId: string,
  deleteSubtasks = false,
): Promise<{ ok: boolean }> => {
  const payload = await invokeFn<{ ok: boolean }>("task_delete", {
    repoPath,
    taskId,
    deleteSubtasks,
  });
  metadataCache.invalidate(repoPath, taskId);
  return payload;
};

export const taskTransition = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  status: TaskStatus,
  reason?: string,
): Promise<TaskCard> => {
  taskStatusSchema.parse(status);
  const payload = await invokeFn<unknown>("task_transition", {
    repoPath,
    taskId,
    status,
    reason,
  });
  return taskCardSchema.parse(payload);
};

export const taskDefer = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
  reason?: string,
): Promise<TaskCard> => {
  const payload = await invokeFn<unknown>("task_defer", {
    repoPath,
    taskId,
    reason,
  });
  return taskCardSchema.parse(payload);
};

export const taskResumeDeferred = async (
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<TaskCard> => {
  const payload = await invokeFn<unknown>("task_resume_deferred", {
    repoPath,
    taskId,
  });
  return taskCardSchema.parse(payload);
};

export const specGet = async (
  metadataCache: TaskMetadataCache,
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<{ markdown: string; updatedAt: string | null }> => {
  const payload = await metadataCache.get(invokeFn, repoPath, taskId);
  return {
    markdown: payload.spec.markdown,
    updatedAt: payload.spec.updatedAt ?? null,
  };
};

export const setSpec = async (
  invokeFn: InvokeFn,
  metadataCache: TaskMetadataCache,
  input: SetSpecInput,
): Promise<SetSpecOutput> => {
  if (!input.repoPath) {
    throw new Error("repoPath is required to set spec");
  }

  const payload = await invokeFn<{ updatedAt: string }>("set_spec", {
    repoPath: input.repoPath,
    taskId: input.taskId,
    markdown: input.markdown,
  });

  metadataCache.invalidate(input.repoPath, input.taskId);
  return { updatedAt: payload.updatedAt };
};

export const saveSpecDocument = async (
  invokeFn: InvokeFn,
  metadataCache: TaskMetadataCache,
  repoPath: string,
  taskId: string,
  markdown: string,
): Promise<SetSpecOutput> => {
  const payload = await invokeFn<{ updatedAt: string }>("spec_save_document", {
    repoPath,
    taskId,
    markdown,
  });
  metadataCache.invalidate(repoPath, taskId);
  return { updatedAt: payload.updatedAt };
};

export const setPlan = async (
  invokeFn: InvokeFn,
  metadataCache: TaskMetadataCache,
  input: SetPlanInput,
): Promise<SetPlanOutput> => {
  if (!input.repoPath) {
    throw new Error("repoPath is required to set plan");
  }

  const payload = await invokeFn<{ updatedAt: string }>("set_plan", {
    repoPath: input.repoPath,
    taskId: input.taskId,
    input: {
      markdown: input.markdown,
      subtasks: input.subtasks,
    },
  });

  metadataCache.invalidate(input.repoPath, input.taskId);
  return { updatedAt: payload.updatedAt };
};

export const savePlanDocument = async (
  invokeFn: InvokeFn,
  metadataCache: TaskMetadataCache,
  repoPath: string,
  taskId: string,
  markdown: string,
): Promise<SetPlanOutput> => {
  const payload = await invokeFn<{ updatedAt: string }>("plan_save_document", {
    repoPath,
    taskId,
    markdown,
  });
  metadataCache.invalidate(repoPath, taskId);
  return { updatedAt: payload.updatedAt };
};

export const planGet = async (
  metadataCache: TaskMetadataCache,
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<{ markdown: string; updatedAt: string | null }> => {
  const payload = await metadataCache.get(invokeFn, repoPath, taskId);
  return {
    markdown: payload.plan.markdown,
    updatedAt: payload.plan.updatedAt ?? null,
  };
};

export const qaGetReport = async (
  metadataCache: TaskMetadataCache,
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<{ markdown: string; updatedAt: string | null }> => {
  const payload = await metadataCache.get(invokeFn, repoPath, taskId);
  return {
    markdown: payload.qaReport?.markdown ?? "",
    updatedAt: payload.qaReport?.updatedAt ?? null,
  };
};

export const qaApproved = async (
  invokeFn: InvokeFn,
  metadataCache: TaskMetadataCache,
  repoPath: string,
  taskId: string,
  markdown: string,
): Promise<TaskCard> => {
  const payload = await invokeFn<unknown>("qa_approved", {
    repoPath,
    taskId,
    input: { markdown },
  });
  metadataCache.invalidate(repoPath, taskId);
  return taskCardSchema.parse(payload);
};

export const qaRejected = async (
  invokeFn: InvokeFn,
  metadataCache: TaskMetadataCache,
  repoPath: string,
  taskId: string,
  markdown: string,
): Promise<TaskCard> => {
  const payload = await invokeFn<unknown>("qa_rejected", {
    repoPath,
    taskId,
    input: { markdown },
  });
  metadataCache.invalidate(repoPath, taskId);
  return taskCardSchema.parse(payload);
};

export const agentSessionsList = async (
  metadataCache: TaskMetadataCache,
  invokeFn: InvokeFn,
  repoPath: string,
  taskId: string,
): Promise<AgentSessionRecord[]> => {
  const payload = await metadataCache.get(invokeFn, repoPath, taskId);
  return payload.agentSessions;
};

export const agentSessionUpsert = async (
  invokeFn: InvokeFn,
  metadataCache: TaskMetadataCache,
  repoPath: string,
  taskId: string,
  session: AgentSessionRecord,
): Promise<void> => {
  await invokeFn<unknown>("agent_session_upsert", {
    repoPath,
    taskId,
    session,
  });
  metadataCache.invalidate(repoPath, taskId);
};

export class TauriTaskClient {
  constructor(
    private readonly invokeFn: InvokeFn,
    private readonly metadataCache: TaskMetadataCache,
  ) {}

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
    return taskDelete(this.invokeFn, this.metadataCache, repoPath, taskId, deleteSubtasks);
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
    return specGet(this.metadataCache, this.invokeFn, repoPath, taskId);
  }

  async setSpec(input: SetSpecInput): Promise<SetSpecOutput> {
    return setSpec(this.invokeFn, this.metadataCache, input);
  }

  async saveSpecDocument(
    repoPath: string,
    taskId: string,
    markdown: string,
  ): Promise<SetSpecOutput> {
    return saveSpecDocument(this.invokeFn, this.metadataCache, repoPath, taskId, markdown);
  }

  async setPlan(input: SetPlanInput): Promise<SetPlanOutput> {
    return setPlan(this.invokeFn, this.metadataCache, input);
  }

  async savePlanDocument(
    repoPath: string,
    taskId: string,
    markdown: string,
  ): Promise<SetPlanOutput> {
    return savePlanDocument(this.invokeFn, this.metadataCache, repoPath, taskId, markdown);
  }

  async planGet(
    repoPath: string,
    taskId: string,
  ): Promise<{ markdown: string; updatedAt: string | null }> {
    return planGet(this.metadataCache, this.invokeFn, repoPath, taskId);
  }

  async qaGetReport(
    repoPath: string,
    taskId: string,
  ): Promise<{ markdown: string; updatedAt: string | null }> {
    return qaGetReport(this.metadataCache, this.invokeFn, repoPath, taskId);
  }

  async qaApproved(repoPath: string, taskId: string, markdown: string): Promise<TaskCard> {
    return qaApproved(this.invokeFn, this.metadataCache, repoPath, taskId, markdown);
  }

  async qaRejected(repoPath: string, taskId: string, markdown: string): Promise<TaskCard> {
    return qaRejected(this.invokeFn, this.metadataCache, repoPath, taskId, markdown);
  }

  async agentSessionsList(repoPath: string, taskId: string): Promise<AgentSessionRecord[]> {
    return agentSessionsList(this.metadataCache, this.invokeFn, repoPath, taskId);
  }

  async agentSessionUpsert(
    repoPath: string,
    taskId: string,
    session: AgentSessionRecord,
  ): Promise<void> {
    return agentSessionUpsert(this.invokeFn, this.metadataCache, repoPath, taskId, session);
  }
}
