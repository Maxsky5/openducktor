import {
  type AgentSessionIdentity,
  type AgentSessionRecord,
  agentSessionRecordSchema,
  jsonValueSchema,
  type PlanSubtaskInput,
  type PullRequest,
  planSubtaskInputSchema,
  pullRequestSchema,
  type TaskCreateInput,
  type TaskDirectMergeInput,
  type TaskStatus,
  type TaskUpdatePatch,
  taskAssetDescriptionMutationSchema,
  taskCreateInputSchema,
  taskDirectMergeInputSchema,
  taskStatusSchema,
  taskUpdatePatchSchema,
  hasRuntimeType,
} from "@openducktor/contracts";
import { z } from "zod";
import { compactAgentSessionRecord } from "../../domain/agent-session-records";
import { HostValidationError } from "../../effect/host-errors";

const invalidInput = (message: string, field?: string): HostValidationError =>
  new HostValidationError({
    message,
    field,
  });

type PullRequestContent = {
  title: string;
  body: string;
};

export const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || !hasRuntimeType(value, "object") || Array.isArray(value)) {
    throw invalidInput(`${label} must be an object.`, label);
  }

  // SAFETY: The preceding runtime guard establishes `Record<string, unknown>` before this assertion.
  return value as Record<string, unknown>;
};

export const requireString = (value: unknown, label: string): string => {
  if (!hasRuntimeType(value, "string") || value.trim().length === 0) {
    throw invalidInput(`${label} is required.`, label);
  }

  return value.trim();
};

export const optionalNonNegativeInteger = (value: unknown, label: string): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Number.isInteger(value) || !hasRuntimeType(value, "number") || value < 0) {
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

export const parseDescriptionAssets = (value: unknown) => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = taskAssetDescriptionMutationSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw invalidInput(`descriptionAssets is invalid: ${parsed.error.message}`, "descriptionAssets");
};

export const parseTransitionStatus = (value: unknown): TaskStatus => {
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
  if (!hasRuntimeType(value, "boolean")) {
    throw invalidInput(`${label} must be a boolean when provided.`, label);
  }

  return value;
};

export const parseRequiredMarkdown = (value: unknown, label: string): string => {
  if (!hasRuntimeType(value, "string")) {
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
  if (!hasRuntimeType(value, "string")) {
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

const agentSessionStringKeys = [
  "externalSessionId",
  "role",
  "startedAt",
  "runtimeKind",
  "workingDirectory",
] as const;
const normalizedAgentSessionInputSchema = z
  .record(z.string(), jsonValueSchema)
  .transform((record) => {
    const normalized = { ...record };
    for (const key of agentSessionStringKeys) {
      const value = normalized[key];
      if (hasRuntimeType(value, "string")) {
        normalized[key] = value.trim();
      }
    }
    return normalized;
  });

const normalizedAgentSessionRecordSchema = normalizedAgentSessionInputSchema.transform(
  (record, context) => {
    const parsed = agentSessionRecordSchema.safeParse(record);
    if (parsed.success) return parsed.data;
    for (const issue of parsed.error.issues) {
      context.addIssue({ code: "custom", message: issue.message, path: issue.path });
    }
    return z.NEVER;
  },
);

export const parseAgentSessionRecord = (value: unknown): AgentSessionRecord => {
  const parsed = normalizedAgentSessionRecordSchema.safeParse(value);
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
const normalizedAgentSessionIdentitySchema = normalizedAgentSessionInputSchema.transform(
  (record, context) => {
    const parsed = agentSessionIdentitySchema.safeParse(record);
    if (parsed.success) return parsed.data;
    for (const issue of parsed.error.issues) {
      context.addIssue({ code: "custom", message: issue.message, path: issue.path });
    }
    return z.NEVER;
  },
);

export const parseAgentSessionIdentity = (value: unknown): AgentSessionIdentity => {
  const parsed = normalizedAgentSessionIdentitySchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw invalidInput(
    `agent_session_delete input.identity is invalid: ${parsed.error.message}`,
    "input.identity",
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

export const parsePullRequestContent = (value: unknown): PullRequestContent => {
  const record = requireRecord(value, "task_pull_request_upsert input.input");
  const title = requireString(record.title, "input.title");
  if (!hasRuntimeType(record.body, "string")) {
    throw invalidInput("input.body is required.", "input.body");
  }

  return { title, body: record.body };
};

export const parseTaskDirectMergeInput = (value: unknown): TaskDirectMergeInput => {
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
