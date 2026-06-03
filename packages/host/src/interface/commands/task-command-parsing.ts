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
import { HostValidationError } from "../../effect/host-errors";

const invalidInput = (message: string, field?: string): HostValidationError =>
  new HostValidationError({
    message,
    field,
  });

export const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidInput(`${label} must be an object.`, label);
  }

  return value as Record<string, unknown>;
};

export const requireString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidInput(`${label} is required.`, label);
  }

  return value.trim();
};

export const optionalNonNegativeInteger = (value: unknown, label: string): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw invalidInput(`${label} must be greater than or equal to 0.`, label);
  }

  return value;
};

export const parseCreateInput = (value: unknown): TaskCreateInput => {
  const parsed = taskCreateInputSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw invalidInput(`task_create input.input is invalid: ${parsed.error.message}`, "input.input");
};

export const parseUpdatePatch = (value: unknown): TaskUpdatePatch => {
  const parsed = taskUpdatePatchSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw invalidInput(`task_update input.patch is invalid: ${parsed.error.message}`, "input.patch");
};

export const parseTransitionStatus = (value: unknown) => {
  const parsed = taskStatusSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw invalidInput(
    `task_transition input.status is invalid: ${parsed.error.message}`,
    "input.status",
  );
};

export const optionalBoolean = (value: unknown, label: string): boolean | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw invalidInput(`${label} must be a boolean when provided.`, label);
  }

  return value;
};

export const parseRequiredMarkdown = (value: unknown, label: string): string => {
  if (typeof value !== "string") {
    throw invalidInput(`${label} markdown cannot be empty.`, label);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw invalidInput(`${label} markdown cannot be empty.`, label);
  }

  return trimmed;
};

export const parseOptionalNote = (value: unknown, label: string): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw invalidInput(`${label} must be a string when present.`, label);
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

  throw invalidInput(
    `set_plan input.input.subtasks is invalid: ${parsed.error.message}`,
    "input.input.subtasks",
  );
};

export const parseTaskIdList = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value)) {
    throw invalidInput(`${label} must be an array.`, label);
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

export const parseAgentSessionRecord = (value: unknown): AgentSessionRecord => {
  const parsed = agentSessionRecordSchema.safeParse(normalizeAgentSessionInput(value));
  if (parsed.success) {
    return parsed.data;
  }

  throw invalidInput(
    `agent_session_upsert input.session is invalid: ${parsed.error.message}`,
    "input.session",
  );
};

export const parsePullRequest = (value: unknown): PullRequest => {
  const parsed = pullRequestSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw invalidInput(
    `task_pull_request_link_merged input.pullRequest is invalid: ${parsed.error.message}`,
    "input.pullRequest",
  );
};

export const parsePullRequestContent = (value: unknown): { title: string; body: string } => {
  const record = requireRecord(value, "task_pull_request_upsert input.input");
  const title = requireString(record.title, "input.title");
  if (typeof record.body !== "string") {
    throw invalidInput("input.body is required.", "input.body");
  }

  return { title, body: record.body };
};

export const parseTaskDirectMergeInput = (value: unknown) => {
  const parsed = taskDirectMergeInputSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw invalidInput(
    `task_direct_merge input.input is invalid: ${parsed.error.message}`,
    "input.input",
  );
};

export const compactAgentSessionForStorage = (session: AgentSessionRecord): AgentSessionRecord => {
  const role = session.role.trim();
  if (!role) {
    throw invalidInput("Agent session role is required", "role");
  }

  const externalSessionId = session.externalSessionId.trim();
  if (!externalSessionId) {
    throw invalidInput("Agent session externalSessionId is required", "externalSessionId");
  }

  const startedAt = session.startedAt.trim();
  if (!startedAt) {
    throw invalidInput("Agent session startedAt is required", "startedAt");
  }

  const runtimeKind = session.runtimeKind.trim();
  if (!runtimeKind) {
    throw invalidInput("Agent session runtimeKind is required", "runtimeKind");
  }

  const workingDirectory = session.workingDirectory.trim();
  if (!workingDirectory) {
    throw invalidInput("Agent session workingDirectory is required", "workingDirectory");
  }

  if (session.selectedModel !== null && !session.selectedModel.runtimeKind.trim()) {
    throw invalidInput(
      "Agent session selectedModel.runtimeKind is required",
      "selectedModel.runtimeKind",
    );
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
