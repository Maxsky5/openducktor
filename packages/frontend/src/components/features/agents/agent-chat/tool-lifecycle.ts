import type { ToolMeta } from "./agent-chat-message-card-model.types";
import type { JsonValue } from "@openducktor/contracts";

const TOOL_CANCELLED_PATTERN = /\b(cancel(?:ed|led)|aborted|stopped|interrupted|terminated)\b/i;

const hasMeaningfulInputValue = (value: JsonValue | undefined): boolean => {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasMeaningfulInputValue(entry));
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.values(value as Record<string, JsonValue>).some((entry) =>
    hasMeaningfulInputValue(entry),
  );
};

export const hasNonEmptyInput = (input: Record<string, JsonValue> | undefined): boolean => {
  return input ? Object.values(input).some((value) => hasMeaningfulInputValue(value)) : false;
};

export const hasNonEmptyText = (value: JsonValue | undefined): value is string => {
  return typeof value === "string" && value.trim().length > 0;
};

export const isToolMessageFailure = (meta: ToolMeta): boolean => {
  return meta.status === "error";
};

export const isToolMessageCancelled = (meta: ToolMeta): boolean => {
  if (meta.status !== "error") {
    return false;
  }

  return (
    (hasNonEmptyText(meta.error) && TOOL_CANCELLED_PATTERN.test(meta.error)) ||
    (hasNonEmptyText(meta.output) && TOOL_CANCELLED_PATTERN.test(meta.output))
  );
};

type ToolLifecyclePhase = "queued" | "executing" | "completed" | "cancelled" | "failed";

export const getToolLifecyclePhase = (meta: ToolMeta): ToolLifecyclePhase => {
  if (meta.status === "pending") {
    return hasNonEmptyInput(meta.input) ? "executing" : "queued";
  }
  if (meta.status === "running") {
    return "executing";
  }
  if (meta.status === "completed") {
    return isToolMessageFailure(meta) ? "failed" : "completed";
  }
  return isToolMessageCancelled(meta) ? "cancelled" : "failed";
};
