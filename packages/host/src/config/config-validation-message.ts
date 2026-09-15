import { z } from "zod";

export type ConfigPayloadValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ConfigPayloadValue[]
  | { [key: string]: ConfigPayloadValue };

const configPayloadValueSchema: z.ZodType<ConfigPayloadValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.undefined(),
    z.array(configPayloadValueSchema),
    z.record(z.string(), configPayloadValueSchema),
  ]),
);

const configRecordSchema = z.record(z.string(), configPayloadValueSchema);
const configScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const MAX_REPORTED_ISSUES = 5;
const MAX_REPORTED_VALUE_LENGTH = 60;

const formatIssuePath = (path: readonly PropertyKey[]): string =>
  path.length === 0 ? "config" : path.map((segment) => String(segment)).join(".");

const readPathValue = (
  payload: ConfigPayloadValue,
  path: readonly PropertyKey[],
): ConfigPayloadValue => {
  let current: ConfigPayloadValue = payload;
  for (const segment of path) {
    const key = String(segment);
    const record = configRecordSchema.safeParse(current);
    if (record.success) {
      current = record.data[key];
      continue;
    }

    const array = z.array(configPayloadValueSchema).safeParse(current);
    if (!array.success) {
      return undefined;
    }
    current = array.data[Number(key)];
  }
  return current;
};

const formatValueHint = (value: ConfigPayloadValue): string => {
  if (value === undefined) {
    return " (missing)";
  }

  const scalar = configScalarSchema.safeParse(value);
  if (scalar.success) {
    const serialized = JSON.stringify(scalar.data) ?? String(scalar.data);
    const text =
      serialized.length > MAX_REPORTED_VALUE_LENGTH
        ? `${serialized.slice(0, MAX_REPORTED_VALUE_LENGTH)}...`
        : serialized;
    return ` (found ${text})`;
  }

  return Array.isArray(value) ? " (found array)" : " (found object)";
};

const formatIssue = (issue: z.core.$ZodIssue, payload: ConfigPayloadValue | undefined): string => {
  const valueHint =
    payload === undefined ? "" : formatValueHint(readPathValue(payload, issue.path));
  return `${formatIssuePath(issue.path)}: ${issue.message}${valueHint}`;
};

const formatConfigIssues = (error: z.ZodError, payload?: ConfigPayloadValue): string => {
  const reported = error.issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => formatIssue(issue, payload));
  const remaining = error.issues.length - MAX_REPORTED_ISSUES;
  if (remaining > 0) {
    reported.push(`${remaining} more ${remaining === 1 ? "problem" : "problems"} not shown.`);
  }
  return reported.join("\n");
};

export const configValidationMessage = (cause: unknown, payload?: ConfigPayloadValue): string => {
  if (cause instanceof z.ZodError) {
    return formatConfigIssues(cause, payload);
  }

  return cause instanceof Error ? cause.message : String(cause);
};
