import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { getToolLifecyclePhase } from "./tool-lifecycle";

const isFiniteTimestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const parseFiniteTimestamp = (timestamp: string): number | null => {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
};

export const getToolDuration = (meta: ToolMeta, messageTimestamp: string): number | null => {
  const lifecyclePhase = getToolLifecyclePhase(meta);
  if (lifecyclePhase === "queued" || lifecyclePhase === "executing") {
    return null;
  }

  if (!isFiniteTimestamp(meta.startedAtMs)) {
    return null;
  }
  if (meta.endedAtMs !== undefined && !isFiniteTimestamp(meta.endedAtMs)) {
    return null;
  }
  const endedAtMs = meta.endedAtMs ?? parseFiniteTimestamp(messageTimestamp);
  if (endedAtMs === null || endedAtMs < meta.startedAtMs) {
    return null;
  }
  return endedAtMs - meta.startedAtMs;
};
