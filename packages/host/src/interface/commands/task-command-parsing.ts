import {
  type AgentSessionRecord,
  agentSessionRecordSchema,
  type PlanSubtaskInput,
  type PullRequest,
  planSubtaskInputSchema,
  pullRequestSchema,
  type TaskCreateInput,
  type TaskUpdatePatch,
  taskCreateInputSchema,
  taskDirectMergeInputSchema,
  taskStatusSchema,
  taskUpdatePatchSchema,
} from "@openducktor/contracts";

export const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
};

export const requireString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
};

export const optionalNonNegativeInteger = (value: unknown, label: string): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw new Error(`${label} must be greater than or equal to 0.`);
  }

  return value;
};

export const requirePositiveInteger = (value: unknown, label: string): number => {
  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
};

export const parseCreateInput = (value: unknown): TaskCreateInput => {
  const parsed = taskCreateInputSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(`task_create input.input is invalid: ${parsed.error.message}`);
};

export const parseUpdatePatch = (value: unknown): TaskUpdatePatch => {
  const parsed = taskUpdatePatchSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(`task_update input.patch is invalid: ${parsed.error.message}`);
};

export const parseTransitionStatus = (value: unknown) => {
  const parsed = taskStatusSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(`task_transition input.status is invalid: ${parsed.error.message}`);
};

export const optionalBoolean = (value: unknown, label: string): boolean | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean when provided.`);
  }

  return value;
};

export const parseRequiredMarkdown = (value: unknown, label: string): string => {
  if (typeof value !== "string") {
    throw new Error(`${label} markdown cannot be empty.`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} markdown cannot be empty.`);
  }

  return trimmed;
};

export const parseOptionalNote = (value: unknown, label: string): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string when present.`);
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

export const parsePlanSubtasks = (value: unknown): PlanSubtaskInput[] => {
  if (value === undefined) {
    return [];
  }

  const parsed = planSubtaskInputSchema.array().safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(`set_plan input.input.subtasks is invalid: ${parsed.error.message}`);
};

export const parseTaskIdList = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value.map((entry, index) => requireString(entry, `${label}[${index}]`));
};

export const normalizeAgentSessionInput = (value: unknown): unknown => {
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

export const parseAgentSessionRecord = (value: unknown): AgentSessionRecord => {
  const parsed = agentSessionRecordSchema.safeParse(normalizeAgentSessionInput(value));
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(`agent_session_upsert input.session is invalid: ${parsed.error.message}`);
};

export const parsePullRequest = (value: unknown): PullRequest => {
  const parsed = pullRequestSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(
    `task_pull_request_link_merged input.pullRequest is invalid: ${parsed.error.message}`,
  );
};

export const parsePullRequestContent = (value: unknown): { title: string; body: string } => {
  const record = requireRecord(value, "task_pull_request_upsert input.input");
  const title = requireString(record.title, "input.title");
  if (typeof record.body !== "string") {
    throw new Error("input.body is required.");
  }

  return { title, body: record.body };
};

export const parseTaskDirectMergeInput = (value: unknown) => {
  const parsed = taskDirectMergeInputSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(`task_direct_merge input.input is invalid: ${parsed.error.message}`);
};

export const compactAgentSessionForStorage = (session: AgentSessionRecord): AgentSessionRecord => {
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
