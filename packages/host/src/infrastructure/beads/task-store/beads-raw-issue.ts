import {
  type IssueType,
  issueTypeSchema,
  type TaskStatus,
  taskStatusSchema,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type {
  BeadsCliContext,
  ResolveBeadsCliContextOptions,
  StopSharedDoltServer,
} from "../../../adapters/beads/beads-cli-context";
import { HostValidationError } from "../../../effect/host-errors";
import type { SystemCommandPort } from "../../../ports/system-command-port";
import type { TaskStoreError, TaskStorePort } from "../../../ports/task-repository-ports";
export const METADATA_NAMESPACE = "openducktor";
export const BD_COMMAND_TIMEOUT_MS = 30000;
export const DOCUMENT_ENCODING_GZIP_BASE64_V1 = "gzip-base64-v1";
export const ODT_SET_SPEC_SOURCE_TOOL = "odt_set_spec";
export const ODT_SET_PLAN_SOURCE_TOOL = "odt_set_plan";
export const ODT_QA_APPROVED_SOURCE_TOOL = "odt_qa_approved";
export const ODT_QA_REJECTED_SOURCE_TOOL = "odt_qa_rejected";
export const VALID_ISSUE_TYPES = "task, feature, bug, epic";
export const VALID_TASK_STATUSES =
  "open, spec_ready, ready_for_dev, in_progress, blocked, ai_review, human_review, deferred, closed";
export type RawDependency = {
  dependencyType: string;
  dependsOnId: string | undefined;
  id: string | undefined;
};
export type RawIssue = {
  id: string;
  title: string;
  description: string;
  notes: string;
  status: string;
  priority: number;
  issueType: string;
  labels: string[];
  owner: string | undefined;
  parent: string | undefined;
  dependencies: RawDependency[];
  metadata: unknown;
  updatedAt: string;
  createdAt: string;
};
export type BeadsCommandJsonOutput =
  | boolean
  | null
  | number
  | string
  | BeadsCommandJsonOutput[]
  | { [key in string]?: BeadsCommandJsonOutput };
export type RunBdJson = (
  repoPath: string,
  args: string[],
  context?: BeadsCliContext,
) => Effect.Effect<BeadsCommandJsonOutput, TaskStoreError>;
export type RunBd = (
  repoPath: string,
  args: string[],
  context?: BeadsCliContext,
) => Effect.Effect<string, TaskStoreError>;
export type ResolveBeadsCliContext = (
  repoPath: string,
  options?: ResolveBeadsCliContextOptions,
) => Effect.Effect<BeadsCliContext, TaskStoreError>;
export type ResolveWorkspaceIdForRepoPath = (
  repoPath: string,
) => Effect.Effect<string | null | undefined, TaskStoreError>;
export type RawBdWherePayload = {
  path?: unknown;
  error?: unknown;
};
export type CreateBeadsTaskRepositoryInput = {
  now?: () => Date;
  processEnv?: NodeJS.ProcessEnv;
  runBd?: RunBd;
  runBdJson?: RunBdJson;
  resolveCliContext?: ResolveBeadsCliContext;
  resolveWorkspaceIdForRepoPath?: ResolveWorkspaceIdForRepoPath;
  stopSharedDoltServer?: StopSharedDoltServer;
  systemCommands?: Pick<SystemCommandPort, "requiredCommandError">;
};
export type BeadsTaskRepositoryShutdownResult = {
  stoppedSharedDoltServers: number;
};
export type BeadsTaskRepository = TaskStorePort & {
  close(): Effect.Effect<BeadsTaskRepositoryShutdownResult, TaskStoreError>;
};
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
export const requireStringField = (
  record: Record<string, unknown>,
  field: string,
  context: string,
): string => {
  const value = record[field];
  if (typeof value !== "string") {
    throw new HostValidationError({
      message: `${context}.${field} must be a string`,
      field,
      details: { context },
    });
  }
  return value;
};
export const stringFieldWithDefault = (
  record: Record<string, unknown>,
  field: string,
  defaultValue: string,
  context: string,
): string => {
  const value = record[field];
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "string") {
    throw new HostValidationError({
      message: `${context}.${field} must be a string`,
      field,
      details: { context },
    });
  }
  return value;
};
export const optionalStringField = (
  record: Record<string, unknown>,
  field: string,
  context: string,
): string | undefined => {
  const value = record[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HostValidationError({
      message: `${context}.${field} must be a string when present`,
      field,
      details: { context },
    });
  }
  return value;
};
export const optionalNumberField = (
  record: Record<string, unknown>,
  field: string,
  defaultValue: number,
  context: string,
): number => {
  const value = record[field];
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "number") {
    throw new HostValidationError({
      message: `${context}.${field} must be a number`,
      field,
      details: { context },
    });
  }
  return value;
};
export const stringArrayFieldWithDefault = (
  record: Record<string, unknown>,
  field: string,
  context: string,
): string[] => {
  const value = record[field];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new HostValidationError({
      message: `${context}.${field} must be an array`,
      field,
      details: { context },
    });
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new HostValidationError({
        message: `${context}.${field}[${index}] must be a string`,
        field,
        details: { context, index },
      });
    }
    return entry;
  });
};
export const parseRawDependency = (value: unknown, context: string): RawDependency => {
  if (!isRecord(value)) {
    throw new HostValidationError({
      message: `${context} must be an object`,
      details: { context },
    });
  }
  const dependencyType =
    stringFieldWithDefault(value, "type", "", context) ||
    stringFieldWithDefault(value, "dependency_type", "", context);
  return {
    dependencyType,
    dependsOnId: optionalStringField(value, "depends_on_id", context),
    id: optionalStringField(value, "id", context),
  };
};
export const parseRawIssue = (value: unknown): RawIssue => {
  if (!isRecord(value)) {
    throw new HostValidationError({
      message: "bd list task entry must be an object",
      details: { context: "bd list task entry" },
    });
  }
  const dependenciesValue = value.dependencies;
  if (dependenciesValue !== undefined && !Array.isArray(dependenciesValue)) {
    throw new HostValidationError({
      message: "task.dependencies must be an array",
      field: "dependencies",
      details: { context: "task" },
    });
  }
  const dependencies = (dependenciesValue ?? []).map((dependency, index) =>
    parseRawDependency(dependency, `dependencies[${index}]`),
  );
  return {
    id: requireStringField(value, "id", "task"),
    title: requireStringField(value, "title", "task"),
    description: stringFieldWithDefault(value, "description", "", "task"),
    notes: stringFieldWithDefault(value, "notes", "", "task"),
    status: requireStringField(value, "status", "task"),
    priority: optionalNumberField(value, "priority", 0, "task"),
    issueType: stringFieldWithDefault(value, "issue_type", "", "task"),
    labels: stringArrayFieldWithDefault(value, "labels", "task"),
    owner: optionalStringField(value, "owner", "task"),
    parent: optionalStringField(value, "parent", "task"),
    dependencies,
    metadata: value.metadata,
    updatedAt: requireStringField(value, "updated_at", "task"),
    createdAt: requireStringField(value, "created_at", "task"),
  };
};
export const parseIssueType = (taskId: string, value: string): IssueType => {
  const parsed = issueTypeSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new HostValidationError({
    message: `Invalid Beads issue type for task ${taskId}: received ${JSON.stringify(value)}. Expected one of: ${VALID_ISSUE_TYPES}.`,
    field: "issue_type",
    details: { taskId, value, expected: VALID_ISSUE_TYPES },
  });
};
export const parseTaskStatus = (taskId: string, value: string): TaskStatus => {
  const parsed = taskStatusSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new HostValidationError({
    message: `Invalid Beads status for task ${taskId}: received ${JSON.stringify(value)}. Expected one of: ${VALID_TASK_STATUSES}.`,
    field: "status",
    details: { taskId, value, expected: VALID_TASK_STATUSES },
  });
};
export const normalizeLabels = (labels: string[]): string[] =>
  Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean))).sort();
export const normalizeTextOption = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};
