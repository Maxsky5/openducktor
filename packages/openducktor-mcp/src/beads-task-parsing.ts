import { issueTypeSchema, taskStatusSchema } from "@openducktor/contracts";
import type { IssueType, TaskStatus } from "./contracts";

const TASK_STATUS_SET = new Set<string>(taskStatusSchema.options);
const TASK_STATUS_VALUES = taskStatusSchema.options.join(", ");
const ISSUE_TYPE_VALUES = issueTypeSchema.options.join(", ");
const NON_TASK_BEADS_ISSUE_TYPES = new Set(["event", "gate"]);

const describeInvalidValue = (value: unknown): string => {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  const serialized = JSON.stringify(value);
  if (typeof serialized === "string") {
    return serialized;
  }

  return String(value);
};

export const isNonTaskBeadsIssueType = (value: unknown): boolean => {
  return typeof value === "string" && NON_TASK_BEADS_ISSUE_TYPES.has(value);
};

export const parseBeadsIssueType = (taskId: string, value: unknown): IssueType => {
  const parsed = issueTypeSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid Beads issue type for task ${taskId}: received ${describeInvalidValue(value)}. ` +
        `Expected one of: ${ISSUE_TYPE_VALUES}.`,
    );
  }

  return parsed.data;
};

export const parseBeadsTaskStatus = (taskId: string, value: unknown): TaskStatus => {
  const parsed = taskStatusSchema.safeParse(value);
  if (!parsed.success || !TASK_STATUS_SET.has(parsed.data)) {
    throw new Error(
      `Invalid Beads status for task ${taskId}: received ${describeInvalidValue(value)}. ` +
        `Expected one of: ${TASK_STATUS_VALUES}.`,
    );
  }

  return parsed.data;
};
