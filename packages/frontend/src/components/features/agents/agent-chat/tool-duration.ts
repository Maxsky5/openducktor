import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { getToolLifecyclePhase } from "./tool-lifecycle";

export const getToolDuration = (meta: ToolMeta, messageTimestamp: string): number | null => {
  const lifecyclePhase = getToolLifecyclePhase(meta);
  if (lifecyclePhase === "queued" || lifecyclePhase === "executing") {
    return null;
  }

  if (typeof meta.startedAtMs !== "number") {
    return null;
  }
  const endedAtMs =
    typeof meta.endedAtMs === "number"
      ? meta.endedAtMs
      : Number.isNaN(Date.parse(messageTimestamp))
        ? null
        : Date.parse(messageTimestamp);
  if (endedAtMs === null || Number.isNaN(endedAtMs) || endedAtMs < meta.startedAtMs) {
    return null;
  }
  return endedAtMs - meta.startedAtMs;
};
