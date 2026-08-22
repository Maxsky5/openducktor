import {
  type AgentSessionIdentity,
  type AgentSessionRecord,
  agentSessionRecordSchema,
  type PlanSubtaskInput,
  type PullRequest,
  planSubtaskInputSchema,
  pullRequestSchema,
  type TaskCreateInput,
  type TaskUpdatePatch,
  taskAssetDescriptionMutationSchema,
  taskCreateInputSchema,
  taskDirectMergeInputSchema,
  taskStatusSchema,
  taskUpdatePatchSchema,
  hasRuntimeType,
} from "@openducktor/contracts";
import { compactAgentSessionRecord } from "../../domain/agent-session-records";
import { HostValidationError } from "../../effect/host-errors";
import type { JsonValue } from "@openducktor/contracts";

const invalidInput = (message: string, field?: string): HostValidationError =>
  new HostValidationError({
    message,
    field,
  });

export const requireRecord = (
  value: JsonValue | undefined,
  label: string,
): Record<string, JsonValue> => {
  if (!value || !hasRuntimeType(value, "object") || Array.isArray(value)) {
    throw invalidInput(`${label} must be an object.`, label);
  }

  // SAFETY: The preceding runtime guard establishes `Record<string, JsonValue>` before this assertion.
  return value as Record<string, JsonValue>;
};

export const requireString = (value: JsonValue | undefined, label: string): string => {
  if (!hasRuntimeType(value, "string") || value.trim().length === 0) {
    throw invalidInput(`${label} is required.`, label);
  }

  return value.trim();
};

export const optionalNonNegativeInteger = (
  value: JsonValue | undefined,
  label: string,
): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Number.isInteger(value) || !hasRuntimeType(value, "number") || value < 0) {
    throw invalidInput(`${label} must be greater than or equal to 0.`, label);
  }

  return value;
};

export const parseCreateInput = (value: JsonValue | undefined): TaskCreateInput => {
  const parsed = taskCreateInputSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw invalidInput(`task_create input.input is invalid: ${parsed.error.message}`, "input.input");
};

export const parseUpdatePatch = (value: JsonValue | undefined): TaskUpdatePatch => {
  const parsed = taskUpdatePatchSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw invalidInput(`task_update input.patch is invalid: ${parsed.error.message}`, "input.patch");
};

export const parseDescriptionAssets = (value: JsonValue | undefined) => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = taskAssetDescriptionMutationSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw invalidInput(`descriptionAssets is invalid: ${parsed.error.message}`, "descriptionAssets");
};

export const parseTransitionStatus = (value: JsonValue | undefined) => {
  const parsed = taskStatusSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw invalidInput(
    `task_transition input.status is invalid: ${parsed.error.message}`,
    "input.status",
  );
};

export const optionalBoolean = (
  value: JsonValue | undefined,
  label: string,
): boolean | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!hasRuntimeType(value, "boolean")) {
    throw invalidInput(`${label} must be a boolean when provided.`, label);
  }

  return value;
};

export const parseRequiredMarkdown = (value: JsonValue | undefined, label: string): string => {
  if (!hasRuntimeType(value, "string")) {
    throw invalidInput(`${label} markdown cannot be empty.`, label);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw invalidInput(`${label} markdown cannot be empty.`, label);
  }

  return trimmed;
};

export const parseOptionalNote = (
  value: JsonValue | undefined,
  label: string,
): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!hasRuntimeType(value, "string")) {
    throw invalidInput(`${label} must be a string when present.`, label);
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

export const parsePlanSubtasks = (value: JsonValue | undefined): PlanSubtaskInput[] => {
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

const normalizeAgentSessionInput = (value: JsonValue | undefined): JsonValue | undefined => {
  if (!value || !hasRuntimeType(value, "object") || Array.isArray(value)) {
    return value;
  }

  // SAFETY: The preceding runtime guard establishes `Record<string, JsonValue>` before this assertion.
  const record = value as Record<string, JsonValue>;
  return {
    ...record,
    ...(hasRuntimeType(record.externalSessionId, "string")
      ? { externalSessionId: record.externalSessionId.trim() }
      : undefined),
    ...(hasRuntimeType(record.role, "string") ? { role: record.role.trim() } : undefined),
    ...(hasRuntimeType(record.startedAt, "string")
      ? { startedAt: record.startedAt.trim() }
      : undefined),
    ...(hasRuntimeType(record.runtimeKind, "string")
      ? { runtimeKind: record.runtimeKind.trim() }
      : undefined),
    ...(hasRuntimeType(record.workingDirectory, "string")
      ? { workingDirectory: record.workingDirectory.trim() }
      : undefined),
  };
};

export const parseAgentSessionRecord = (value: JsonValue | undefined): AgentSessionRecord => {
  const parsed = agentSessionRecordSchema.safeParse(normalizeAgentSessionInput(value));
  if (parsed.success) {
    return parsed.data;
  }

  throw invalidInput(
    `agent_session_upsert input.session is invalid: ${parsed.error.message}`,
    "input.session",
  );
};

const agentSessionIdentitySchema = agentSessionRecordSchema.pick({
  externalSessionId: true,
  runtimeKind: true,
  workingDirectory: true,
});

export const parseAgentSessionIdentity = (value: JsonValue | undefined): AgentSessionIdentity => {
  const parsed = agentSessionIdentitySchema.safeParse(normalizeAgentSessionInput(value));
  if (parsed.success) {
    return parsed.data;
  }

  throw invalidInput(
    `agent_session_delete input.identity is invalid: ${parsed.error.message}`,
    "input.identity",
  );
};

export const parsePullRequest = (value: JsonValue | undefined): PullRequest => {
  const parsed = pullRequestSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw invalidInput(
    `task_pull_request_link_merged input.pullRequest is invalid: ${parsed.error.message}`,
    "input.pullRequest",
  );
};

export const parsePullRequestContent = (value: JsonValue | undefined) => {
  const record = requireRecord(value, "task_pull_request_upsert input.input");
  const title = requireString(record.title, "input.title");
  if (!hasRuntimeType(record.body, "string")) {
    throw invalidInput("input.body is required.", "input.body");
  }

  return { title, body: record.body } satisfies { title: string; body: string };
};

export const parseTaskDirectMergeInput = (value: JsonValue | undefined) => {
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
  const compacted = compactAgentSessionRecord(session);
  if (compacted.success) {
    return compacted.session;
  }

  throw invalidInput(compacted.error.message, compacted.error.field);
};
