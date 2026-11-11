import type { AgentToolData } from "@openducktor/contracts";
import type { ToolMeta } from "./agent-chat-message-card-model.types";

// A call that stopped, or that never ran because the user or a policy declined it. Claude gives
// its own sentence for a declined call.
const TOOL_CANCELLED_PATTERN =
  /\b(cancel(?:ed|led)|aborted|stopped|interrupted|terminated|declined)\b|doesn't want to take this action/i;

type AgentToolValue = AgentToolData[string];

const isStringValue = (value: AgentToolValue): value is string =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- AgentToolData has already passed boundary validation.
  typeof value === "string";

const isNumberOrBooleanValue = (value: AgentToolValue): value is number | boolean =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Preserve the finite-number rule without allocating parse errors.
  (typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean";

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
  if (value === null) {
    return false;
  }
  return Object.values(value).some((entry) => hasMeaningfulInputValue(entry));
};

export const hasNonEmptyInput = (input: AgentToolData | undefined): boolean => {
  return input ? Object.values(input).some((value) => hasMeaningfulInputValue(value)) : false;
};

export const hasNonEmptyText = (value: AgentToolValue | undefined): value is string => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Tool fields have already passed boundary validation.
  return typeof value === "string" && value.trim().length > 0;
};

export const isToolMessageFailure = (meta: ToolMeta): boolean => {
  return meta.status === "error";
};

export const isToolMessageActive = (meta: ToolMeta): boolean => {
  return meta.status === "pending" || meta.status === "running";
};

export const isToolMessageCancelled = (meta: ToolMeta): boolean => {
  if (meta.status !== "error") {
    return false;
  }
  const backgroundTaskStatus = meta.metadata?.backgroundTaskStatus;
  if (backgroundTaskStatus === "stopped") return true;
  if (backgroundTaskStatus === "failed" || backgroundTaskStatus === "unknown") return false;

  // A command that exited with an error code ran, so it failed. Some runtimes give its output as
  // its error, and the output can hold words such as `aborted` for other reasons.
  const exit = meta.metadata?.exit;
  if (Number.isFinite(exit) && exit !== 0) return false;

  // The error says why the call stopped. The output of a failed command can hold words such as
  // `stopped` for other reasons, so it counts only for a call without an error.
  if (hasNonEmptyText(meta.error)) return TOOL_CANCELLED_PATTERN.test(meta.error);
  return hasNonEmptyText(meta.output) && TOOL_CANCELLED_PATTERN.test(meta.output);
};

export type ToolLifecyclePhase =
  | "preparing"
  | "queued"
  | "executing"
  | "completed"
  | "cancelled"
  | "failed";

/** The label of each phase of a tool call, as the clients show it. */
export const TOOL_LIFECYCLE_LABELS = {
  preparing: "Preparing",
  queued: "Pending",
  executing: "Running",
  completed: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
} as const satisfies Record<ToolLifecyclePhase, string>;

// A tool meta does not change after it is built, and the error of a failed command can hold its
// whole output, so each meta reads its phase once.
const phases = new WeakMap<ToolMeta, ToolLifecyclePhase>();

export const getToolLifecyclePhase = (meta: ToolMeta): ToolLifecyclePhase => {
  const known = phases.get(meta);
  if (known) return known;
  const phase = readToolLifecyclePhase(meta);
  phases.set(meta, phase);
  return phase;
};

const readToolLifecyclePhase = (meta: ToolMeta): ToolLifecyclePhase => {
  if (meta.status === "pending") {
    if (meta.inputStreaming) return "preparing";
    if (meta.inputStreaming === false) return "queued";
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
