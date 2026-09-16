import { z } from "zod";
import { errorMessage, HostValidationError } from "../effect/host-errors";

export type PayloadValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | PayloadValue[]
  | { [key: string]: PayloadValue };

export const configValidationMessage = (cause: unknown, payload?: PayloadValue): string => {
  if (!(cause instanceof z.ZodError)) {
    return errorMessage(cause);
  }

  const lines = cause.issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => formatIssueLine(issue, payload));
  const remaining = cause.issues.length - MAX_REPORTED_ISSUES;
  if (remaining > 0) {
    lines.push(`${remaining} more ${remaining === 1 ? "problem" : "problems"} not shown.`);
  }

  return lines.join("\n");
};

export const configValidationError = (
  cause: unknown,
  payload?: PayloadValue,
): HostValidationError =>
  new HostValidationError({
    message: configValidationMessage(cause, payload),
    cause,
  });

const MAX_REPORTED_ISSUES = 5;
const MAX_REPORTED_VALUE_LENGTH = 60;

const nestedIssueSchema = z.object({ issues: z.array(z.object({ message: z.string() })) });

const payloadValueSchema: z.ZodType<PayloadValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.undefined(),
    z.array(payloadValueSchema),
    z.record(z.string(), payloadValueSchema),
  ]),
);

const recordSchema = z.record(z.string(), payloadValueSchema);
const arraySchema = z.array(payloadValueSchema);
const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const toPayloadValue = <Value>(value: Value): PayloadValue | undefined => {
  const parsed = payloadValueSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

const formatIssueLine = (issue: z.core.$ZodIssue, payload?: PayloadValue): string => {
  const path = formatPath(issue.path);
  const nested = nestedIssueSchema.safeParse(issue);
  if (nested.success) {
    return `${path}: ${cleanLine(nested.data.issues[0]?.message ?? issue.message)} (invalid key)`;
  }

  const reason = cleanLine(issue.message);
  if (payload === undefined) {
    return `${path}: ${reason}`;
  }

  return `${path}: ${reason}${formatValueHint(readPathValue(payload, issue.path))}`;
};

const cleanLine = (text: string): string => text.replace(/\s+/gu, " ").trim();

const formatPath = (path: readonly PropertyKey[]): string =>
  path.length === 0 ? "config" : path.map((segment) => String(segment)).join(".");

const readPathValue = (payload: PayloadValue, path: readonly PropertyKey[]): PayloadValue => {
  let current: PayloadValue = payload;
  for (const segment of path) {
    const key = String(segment);
    const record = recordSchema.safeParse(current);
    if (record.success) {
      current = record.data[key];
      continue;
    }

    const array = arraySchema.safeParse(current);
    if (!array.success) {
      return undefined;
    }
    current = array.data[Number(key)];
  }
  return current;
};

const formatValueHint = (value: PayloadValue): string => {
  if (value === undefined) {
    return " (missing)";
  }

  const scalar = scalarSchema.safeParse(value);
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
