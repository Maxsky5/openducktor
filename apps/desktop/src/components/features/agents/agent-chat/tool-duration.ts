import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { getToolLifecyclePhase, hasNonEmptyInput } from "./tool-lifecycle";

export const getToolDuration = (meta: ToolMeta, messageTimestamp: string): number | null => {
  const lifecyclePhase = getToolLifecyclePhase(meta);
  if (lifecyclePhase === "queued" || lifecyclePhase === "executing") {
    return null;
  }

  const parsedMessageTimestamp = Date.parse(messageTimestamp);
  const completionAtMs =
    typeof meta.observedEndedAtMs === "number"
      ? meta.observedEndedAtMs
      : typeof meta.endedAtMs === "number"
        ? meta.endedAtMs
        : Number.isNaN(parsedMessageTimestamp)
          ? null
          : parsedMessageTimestamp;
  const inputReadyAtMs =
    typeof meta.inputReadyAtMs === "number"
      ? meta.inputReadyAtMs
      : hasNonEmptyInput(meta.input)
        ? typeof meta.observedStartedAtMs === "number"
          ? meta.observedStartedAtMs
          : typeof meta.startedAtMs === "number"
            ? meta.startedAtMs
            : null
        : null;
  if (completionAtMs !== null && inputReadyAtMs !== null && completionAtMs >= inputReadyAtMs) {
    return completionAtMs - inputReadyAtMs;
  }

  const observedStartedAtMs =
    typeof meta.observedStartedAtMs === "number" ? meta.observedStartedAtMs : null;
  const observedEndedAtMs =
    typeof meta.observedEndedAtMs === "number"
      ? meta.observedEndedAtMs
      : Number.isNaN(parsedMessageTimestamp)
        ? null
        : parsedMessageTimestamp;
  if (
    observedStartedAtMs !== null &&
    observedEndedAtMs !== null &&
    !Number.isNaN(observedEndedAtMs) &&
    observedEndedAtMs >= observedStartedAtMs
  ) {
    return observedEndedAtMs - observedStartedAtMs;
  }

  if (typeof meta.startedAtMs !== "number") {
    return null;
  }
  const endedAtMs =
    typeof meta.endedAtMs === "number"
      ? meta.endedAtMs
      : Number.isNaN(parsedMessageTimestamp)
        ? null
        : parsedMessageTimestamp;
  if (endedAtMs === null || Number.isNaN(endedAtMs) || endedAtMs < meta.startedAtMs) {
    return null;
  }
  return endedAtMs - meta.startedAtMs;
};
