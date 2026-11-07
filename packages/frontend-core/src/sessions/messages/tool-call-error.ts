import { odtToolErrorPayloadSchema } from "@openducktor/contracts";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { getToolLifecyclePhase, hasNonEmptyText } from "./tool-lifecycle";

/** The error of a failed call as a reader sees it. */
export type ToolCallError = {
  /** One readable line. */
  message: string;
  /**
   * The full error text, such as an ODT error with its code and details. Null when the message is
   * all of it.
   */
  detail: string | null;
};

export const TOOL_CALL_FAILED_MESSAGE = "The tool call failed.";
export const TOOL_CALL_ERROR_IN_DETAILS_MESSAGE = "The tool call failed. Open it to see the error.";

/**
 * Reads the error of a failed call. An ODT tool returns `{ ok: false, error }`, so its message is
 * the line. Other JSON never shows as the line. Plain error text, such as a runtime error, is the
 * line itself. Null when the call did not fail.
 */
export const readToolCallError = (meta: ToolMeta): ToolCallError | null =>
  getToolLifecyclePhase(meta) === "failed" ? readFailedToolCallError(meta) : null;

/** Reads the error of a call that failed. */
const readFailedToolCallError = (meta: ToolMeta): ToolCallError => {
  const text = hasNonEmptyText(meta.error)
    ? meta.error.trim()
    : hasNonEmptyText(meta.output)
      ? meta.output.trim()
      : "";
  if (!text) return { message: TOOL_CALL_FAILED_MESSAGE, detail: null };
  const parsed = parseErrorText(text);
  if (parsed.kind === "text") return { message: text, detail: null };
  return {
    message: parsed.kind === "odt_error" ? parsed.message : TOOL_CALL_ERROR_IN_DETAILS_MESSAGE,
    detail: text,
  };
};

type ParsedErrorText = { kind: "odt_error"; message: string } | { kind: "json" } | { kind: "text" };

/** Tells an ODT error envelope and other JSON objects or arrays from plain error text. */
const parseErrorText = (text: string): ParsedErrorText => {
  if (!text.startsWith("{") && !text.startsWith("[")) return { kind: "text" };
  try {
    const payload = odtToolErrorPayloadSchema.safeParse(JSON.parse(text));
    return payload.success
      ? { kind: "odt_error", message: payload.data.error.message }
      : { kind: "json" };
  } catch {
    return { kind: "text" };
  }
};
