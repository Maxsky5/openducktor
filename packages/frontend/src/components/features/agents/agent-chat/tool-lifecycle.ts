import { agentToolDataSchema, type AgentToolData } from "@openducktor/contracts";
import { z } from "zod";
import type { ToolMeta } from "./agent-chat-message-card-model.types";

const TOOL_CANCELLED_PATTERN = /\b(cancel(?:ed|led)|aborted|stopped|interrupted|terminated)\b/i;

const stringValueSchema = z.string();
const numberOrBooleanValueSchema = z.union([z.number(), z.boolean()]);
type AgentToolValue = AgentToolData[string];

const isStringValue = (value: AgentToolValue): value is string =>
  stringValueSchema.safeParse(value).success;

const isNumberOrBooleanValue = (value: AgentToolValue): value is number | boolean =>
  numberOrBooleanValueSchema.safeParse(value).success;

const hasMeaningfulInputValue = (value: AgentToolValue): boolean => {
  if (isStringValue(value)) {
    return value.trim().length > 0;
  }
  if (isNumberOrBooleanValue(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasMeaningfulInputValue(entry));
  }
  const objectValue = agentToolDataSchema.safeParse(value);
  if (!objectValue.success) {
    return false;
  }
  return Object.values(objectValue.data).some((entry) => hasMeaningfulInputValue(entry));
};

export const hasNonEmptyInput = (input: AgentToolData | undefined): boolean => {
  return input ? Object.values(input).some((value) => hasMeaningfulInputValue(value)) : false;
};

export const hasNonEmptyText = (value: AgentToolValue | undefined): value is string => {
  const result = stringValueSchema.safeParse(value);
  return result.success && result.data.trim().length > 0;
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
