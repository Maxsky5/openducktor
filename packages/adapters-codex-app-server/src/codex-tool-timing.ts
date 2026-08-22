import { hasRuntimeType } from "@openducktor/contracts";
import type { AgentStreamPart } from "@openducktor/core";
import type { JsonValue } from "@openducktor/contracts";
import { extractNumberField, extractStringField } from "./codex-app-server-shared";

const CODEX_DURATION_MS_KEYS = ["durationMs", "duration_ms"];
const CODEX_STARTED_MS_KEYS = ["startedAtMs", "started_at_ms"];
const CODEX_ENDED_MS_KEYS = ["endedAtMs", "ended_at_ms"];
const CODEX_COMPLETED_MS_KEYS = ["completedAtMs", "completed_at_ms"];
const CODEX_COMPLETION_MS_KEYS = [...CODEX_COMPLETED_MS_KEYS, ...CODEX_ENDED_MS_KEYS];
const CODEX_COMPLETION_STRING_KEYS = ["completedAt", "completed_at", "endedAt", "ended_at"];
const CODEX_DISPLAY_TIMESTAMP_MS_KEYS = [
  "timestampMs",
  "timestamp_ms",
  "occurredAtMs",
  "occurred_at_ms",
];
const CODEX_DISPLAY_TIMESTAMP_STRING_KEYS = [
  "timestamp",
  "createdAt",
  "created_at",
  "startedAt",
  "started_at",
];

export type CodexToolTimingFields = Pick<
  Extract<AgentStreamPart, { kind: "tool" }>,
  "startedAtMs" | "endedAtMs"
>;

export type CodexToolTimingOptions = {
  allowStartedAtOnly?: boolean;
};

const hasOwnField = (value: Record<string, JsonValue>, keys: string[]): boolean =>
  keys.some((key) => Object.hasOwn(value, key));

const extractOptionalFiniteNumberField = (
  value: Record<string, JsonValue>,
  keys: string[],
  label: string,
): number | null => {
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      continue;
    }
    const candidate = value[key];
    if (candidate === null || candidate === undefined) {
      return null;
    }
    if (hasRuntimeType(candidate, "number") && Number.isFinite(candidate)) {
      return candidate;
    }
    throw new Error(`Codex tool ${label} must be a finite number when present.`);
  }
  return null;
};

export const safeCodexTimestampFromMilliseconds = (millis: number | null): string | null => {
  if (millis === null || !Number.isFinite(millis)) {
    return null;
  }
  const timestamp = new Date(millis);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
};

const parseCodexTimestampString = (timestamp: string | null | undefined): number | null => {
  if (!timestamp) {
    return null;
  }
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
};

const codexItemCompletedAtMs = (item: Record<string, JsonValue>): number | null => {
  const millis = extractNumberField(item, CODEX_COMPLETION_MS_KEYS);
  if (millis !== null) {
    return millis;
  }

  const timestamp = extractStringField(item, CODEX_COMPLETION_STRING_KEYS);
  return parseCodexTimestampString(timestamp);
};

const codexItemTimestampMs = (item: Record<string, JsonValue>): number | null => {
  const completionTimestamp = codexItemCompletedAtMs(item);
  if (completionTimestamp !== null) {
    return completionTimestamp;
  }

  const itemTimestampMs = extractNumberField(item, CODEX_DISPLAY_TIMESTAMP_MS_KEYS);
  if (itemTimestampMs !== null) {
    return itemTimestampMs;
  }

  const startedAtMs = extractNumberField(item, CODEX_STARTED_MS_KEYS);
  if (startedAtMs !== null) {
    return startedAtMs;
  }

  const timestamp = extractStringField(item, CODEX_DISPLAY_TIMESTAMP_STRING_KEYS);
  return parseCodexTimestampString(timestamp);
};

export const codexItemTimestamp = (item: Record<string, JsonValue>): string | null =>
  safeCodexTimestampFromMilliseconds(codexItemTimestampMs(item));

export const withCodexItemCompletedAtMs = (
  item: Record<string, JsonValue>,
): Record<string, JsonValue> => {
  if (hasOwnField(item, CODEX_COMPLETION_MS_KEYS)) {
    return item;
  }
  const completedAtMs = codexItemCompletedAtMs(item);
  return completedAtMs !== null ? { ...item, completedAtMs } : item;
};

export const codexToolTimingFields = (
  value: Record<string, JsonValue>,
  options: CodexToolTimingOptions = {},
): CodexToolTimingFields => {
  const durationMs = extractOptionalFiniteNumberField(value, CODEX_DURATION_MS_KEYS, "durationMs");
  const explicitStartedAtMs = extractOptionalFiniteNumberField(
    value,
    CODEX_STARTED_MS_KEYS,
    "startedAtMs",
  );
  const explicitEndedAtMs = extractOptionalFiniteNumberField(
    value,
    CODEX_ENDED_MS_KEYS,
    "endedAtMs",
  );
  const completedAtMs = extractOptionalFiniteNumberField(
    value,
    CODEX_COMPLETED_MS_KEYS,
    "completedAtMs",
  );
  const endedAtMs =
    explicitEndedAtMs ??
    completedAtMs ??
    (hasRuntimeType(explicitStartedAtMs, "number") && hasRuntimeType(durationMs, "number")
      ? explicitStartedAtMs + durationMs
      : null);
  const startedAtMs =
    explicitStartedAtMs ??
    (hasRuntimeType(durationMs, "number") && hasRuntimeType(endedAtMs, "number")
      ? Math.max(0, endedAtMs - durationMs)
      : null);

  const canEmitStartedAtMs =
    hasRuntimeType(startedAtMs, "number") &&
    (options.allowStartedAtOnly === true || hasRuntimeType(endedAtMs, "number"));

  return {
    ...(() => {
      if (canEmitStartedAtMs) {
        return { startedAtMs };
      }
      return {};
    })(),
    ...(() => {
      if (hasRuntimeType(endedAtMs, "number")) {
        return { endedAtMs };
      }
      return {};
    })(),
  };
};
