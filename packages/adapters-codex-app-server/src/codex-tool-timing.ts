import type { AgentStreamPart } from "@openducktor/core";
import type { CodexTimedThreadItem } from "./codex-event-mapper";

export type CodexToolTimingFields = Pick<
  Extract<AgentStreamPart, { kind: "tool" }>,
  "startedAtMs" | "endedAtMs"
>;

export type CodexToolTimingOptions = {
  allowStartedAtOnly?: boolean;
};

export const safeCodexTimestampFromMilliseconds = (millis: number | null): string | null => {
  if (millis === null || !Number.isFinite(millis)) {
    return null;
  }
  const timestamp = new Date(millis);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
};

const finiteTimingValue = (value: number | null | undefined, label: string): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isFinite(value)) {
    throw new Error(`Codex tool ${label} must be a finite number when present.`);
  }
  return value;
};

const codexItemDurationMs = (item: CodexTimedThreadItem): number | null =>
  "durationMs" in item ? finiteTimingValue(item.durationMs, "durationMs") : null;

export const codexItemTimestamp = (item: CodexTimedThreadItem): string | null =>
  safeCodexTimestampFromMilliseconds(item.completedAtMs ?? item.startedAtMs ?? null);

export const codexToolTimingFields = (
  value: CodexTimedThreadItem,
  options: CodexToolTimingOptions = {},
): CodexToolTimingFields => {
  const durationMs = codexItemDurationMs(value);
  const explicitStartedAtMs = finiteTimingValue(value.startedAtMs, "startedAtMs");
  const completedAtMs = finiteTimingValue(value.completedAtMs, "completedAtMs");
  const endedAtMs =
    completedAtMs ??
    (explicitStartedAtMs !== null && durationMs !== null ? explicitStartedAtMs + durationMs : null);
  const startedAtMs =
    explicitStartedAtMs ??
    (durationMs !== null && endedAtMs !== null ? Math.max(0, endedAtMs - durationMs) : null);

  const canEmitStartedAtMs =
    startedAtMs !== null && (options.allowStartedAtOnly === true || endedAtMs !== null);

  const timing: CodexToolTimingFields = {};
  if (canEmitStartedAtMs) {
    timing.startedAtMs = startedAtMs;
  }
  if (endedAtMs !== null) {
    timing.endedAtMs = endedAtMs;
  }
  return timing;
};
