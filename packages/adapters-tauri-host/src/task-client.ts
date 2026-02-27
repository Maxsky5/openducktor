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
  input: {
    taskId: string;
    markdown: string;
    repoPath?: string;
  },
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
  input: {
    taskId: string;
    markdown: string;
    subtasks?: Array<{
      title: string;
      issueType?: "task" | "feature" | "bug";
      priority?: number;
      description?: string;
    }>;
    repoPath?: string;
  },
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
