import {
  type AgentSessionIdentity,
  agentSessionRecordSchema,
  type PlanSubtaskInput,
  type PullRequest,
  type TaskCreateInput,
  type TaskDirectMergeInput,
  type TaskAssetDescriptionMutation,
  type TaskStatus,
  type TaskUpdatePatch,
} from "@openducktor/contracts";
import { z } from "zod";
import { HostValidationError } from "../../effect/host-errors";
import {
  commandInputStringSchema,
  type CommandInputRecord,
  requireParsedRecord,
} from "./command-inputs";

const invalidInput = (message: string, field?: string): HostValidationError =>
  new HostValidationError({
    message,
    field,
  });

type PullRequestContent = {
  title: string;
  body: string;
};

export const requireString = (result: z.ZodSafeParseResult<string>, label: string): string => {
  if (!result.success || result.data.trim().length === 0) {
    throw invalidInput(`${label} is required.`, label);
  }

  return result.data.trim();
};

export const parseCreateInput = (
  result: z.ZodSafeParseResult<TaskCreateInput>,
): TaskCreateInput => {
  if (result.success) {
    return result.data;
  }

  throw invalidInput(`task_create input.input is invalid: ${result.error.message}`, "input.input");
};

export const parseUpdatePatch = (
  result: z.ZodSafeParseResult<TaskUpdatePatch>,
): TaskUpdatePatch => {
  if (result.success) {
    return result.data;
  }

  throw invalidInput(`task_update input.patch is invalid: ${result.error.message}`, "input.patch");
};

export const parseDescriptionAssets = (
  result: z.ZodSafeParseResult<TaskAssetDescriptionMutation | undefined>,
): TaskAssetDescriptionMutation | undefined => {
  if (result.success) {
    return result.data;
  }
  throw invalidInput(`descriptionAssets is invalid: ${result.error.message}`, "descriptionAssets");
};

export const parseTransitionStatus = (result: z.ZodSafeParseResult<TaskStatus>): TaskStatus => {
  if (result.success) {
    return result.data;
  }

  throw invalidInput(
    `task_transition input.status is invalid: ${result.error.message}`,
    "input.status",
  );
};

export const optionalBoolean = (
  result: z.ZodSafeParseResult<boolean | null | undefined>,
  label: string,
): boolean | undefined => {
  if (!result.success) {
    throw invalidInput(`${label} must be a boolean when provided.`, label);
  }

  return result.data ?? undefined;
};

export const parseRequiredMarkdown = (
  result: z.ZodSafeParseResult<string>,
  label: string,
): string => {
  if (!result.success) {
    throw invalidInput(`${label} markdown cannot be empty.`, label);
  }

  const trimmed = result.data.trim();
  if (!trimmed) {
    throw invalidInput(`${label} markdown cannot be empty.`, label);
  }

  return trimmed;
};

export const parseOptionalNote = (
  result: z.ZodSafeParseResult<string | null | undefined>,
  label: string,
): string | undefined => {
  if (!result.success) {
    throw invalidInput(`${label} must be a string when present.`, label);
  }
  if (result.data === undefined || result.data === null) return undefined;

  const trimmed = result.data.trim();
  return trimmed ? trimmed : undefined;
};

export const parsePlanSubtasks = (
  result: z.ZodSafeParseResult<PlanSubtaskInput[] | undefined>,
): PlanSubtaskInput[] => {
  if (result.success) {
    return result.data ?? [];
  }

  throw invalidInput(
    `set_plan input.input.subtasks is invalid: ${result.error.message}`,
    "input.input.subtasks",
  );
};

const agentSessionStringKeys = [
  "externalSessionId",
  "runtimeKind",
  "workingDirectory",
] as const satisfies ReadonlyArray<keyof AgentSessionIdentity>;
const normalizedAgentSessionInputSchema = z.record(z.string(), z.json()).transform((record) => {
  const normalized = { ...record };
  for (const key of agentSessionStringKeys) {
    const value = normalized[key];
    const parsed = z.string().safeParse(value);
    if (parsed.success) {
      normalized[key] = parsed.data.trim();
    }
  }
  return normalized;
});

const agentSessionIdentitySchema = agentSessionRecordSchema.pick({
  externalSessionId: true,
  runtimeKind: true,
  workingDirectory: true,
});
export const normalizedAgentSessionIdentitySchema = normalizedAgentSessionInputSchema.transform(
  (record, context) => {
    const parsed = agentSessionIdentitySchema.safeParse(record);
    if (parsed.success) return parsed.data;
    for (const issue of parsed.error.issues) {
      context.addIssue({ code: "custom", message: issue.message, path: issue.path });
    }
    return z.NEVER;
  },
);

export const parseAgentSessionIdentity = (
  result: z.ZodSafeParseResult<AgentSessionIdentity>,
): AgentSessionIdentity => {
  if (result.success) {
    return result.data;
  }

  throw invalidInput(
    `agent_session_delete input.identity is invalid: ${result.error.message}`,
    "input.identity",
  );
};

export const parsePullRequest = (result: z.ZodSafeParseResult<PullRequest>): PullRequest => {
  if (result.success) {
    return result.data;
  }

  throw invalidInput(
    `task_pull_request_link_merged input.pullRequest is invalid: ${result.error.message}`,
    "input.pullRequest",
  );
};

export const parsePullRequestContent = (
  result: z.ZodSafeParseResult<CommandInputRecord>,
): PullRequestContent => {
  const record = requireParsedRecord(result, "task_pull_request_upsert input.input");
  const title = requireString(commandInputStringSchema.safeParse(record.title), "input.title");
  const body = z.string().safeParse(record.body);
  if (!body.success) {
    throw invalidInput("input.body is required.", "input.body");
  }

  return { title, body: body.data };
};

export const parseTaskDirectMergeInput = (
  result: z.ZodSafeParseResult<TaskDirectMergeInput>,
): TaskDirectMergeInput => {
  if (result.success) {
    return result.data;
  }

  throw invalidInput(
    `task_direct_merge input.input is invalid: ${result.error.message}`,
    "input.input",
  );
};
