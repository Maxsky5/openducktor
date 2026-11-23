import { ODT_HTML_PREVIEW_TOOL_NAME, odtPublishHtmlResultSchema } from "@openducktor/contracts";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { readOdtToolName } from "./odt-tool-call";
import { getToolLifecyclePhase } from "./tool-lifecycle";
import { parseToolOutput } from "./tool-output-utils";

/** A completed `odt_publish_html` call that the transcript shows as a titled preview. */
export type HtmlPreviewToolCall = {
  previewId: string;
  title: string;
  byteSize: number;
};

/**
 * The published preview reference of a tool part, or null for another call. A failed publication,
 * or a call without a valid host result, stays an ordinary tool row.
 *
 * The raw HTML lives in host workspace folder storage keyed by `previewId` rather than inside the
 * runtime tool input, so reopening a session or compacting history never truncates the preview.
 */
export const readHtmlPreviewToolCall = (meta: ToolMeta): HtmlPreviewToolCall | null => {
  if (readOdtToolName(meta.tool) !== ODT_HTML_PREVIEW_TOOL_NAME) return null;
  if (getToolLifecyclePhase(meta) !== "completed") return null;
  const result = parseToolOutput(odtPublishHtmlResultSchema, meta.output);
  if (!result) return null;
  return {
    previewId: result.htmlPreview.previewId,
    title: result.htmlPreview.title,
    byteSize: result.htmlPreview.byteSize,
  };
};
