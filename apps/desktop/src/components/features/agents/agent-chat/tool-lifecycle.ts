import { isOdtWorkflowMutationToolName } from "@openducktor/core";
import type { ToolMeta } from "./agent-chat-message-card-model.types";

const MCP_TOOL_ERROR_PREFIX = /^\s*mcp\s+error\b/i;
const TOOL_CANCELLED_PATTERN = /\b(cancel(?:ed|led)|aborted|stopped|interrupted|terminated)\b/i;

const hasMeaningfulInputValue = (value: unknown): boolean => {
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
  return Object.values(value as Record<string, unknown>).some((entry) =>
    hasMeaningfulInputValue(entry),
  );
};

export const hasNonEmptyInput = (input: Record<string, unknown> | undefined): boolean => {
  if (!input) {
    return false;
  }
  return Object.values(input).some((value) => hasMeaningfulInputValue(value));
};

export const hasNonEmptyText = (value: unknown): value is string => {
  return typeof value === "string" && value.trim().length > 0;
};

export const isToolMessageFailure = (meta: ToolMeta): boolean => {
  if (meta.status === "error") {
    return true;
  }

  if (
    meta.status === "completed" &&
    isOdtWorkflowMutationToolName(meta.tool) &&
    hasNonEmptyText(meta.output)
  ) {
    return MCP_TOOL_ERROR_PREFIX.test(meta.output);
  }

  return false;
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

export type ToolLifecyclePhase = "queued" | "executing" | "completed" | "cancelled" | "failed";

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
