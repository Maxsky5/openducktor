import { TASK_ASSET_URI_PREFIX } from "@openducktor/contracts";
import { collectTaskDescriptionAssetIdsFromTree } from "@openducktor/frontend-core/tasks/description/task-description-assets";
import { parseMarkdownDocument } from "@/rich-content/markdown/markdown-document";

/** The image types that the host accepts for task images. HEIC photos become JPEG when picked. */
export const TASK_IMAGE_PICKER_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
];

/**
 * The task asset IDs that the images of a description use, with the shared asset rules. The
 * editor reads them after each change, so a description without an asset URI skips the full
 * Markdown parse.
 */
export const collectDescriptionAssetIds = (markdown: string): Set<string> => {
  if (!markdown.includes(TASK_ASSET_URI_PREFIX)) return new Set();
  return collectTaskDescriptionAssetIdsFromTree({
    type: "root",
    children: parseMarkdownDocument(markdown, null).blocks.map((block) => block.node),
  });
};

/** The Markdown of a staged image. */
export const taskImageMarkdown = (name: string, assetId: string): string =>
  `![${name.replace(/[[\]]/g, "")}](${TASK_ASSET_URI_PREFIX}${assetId})`;

/** Inserts text at a cursor position on its own lines. */
export type CursorEdit = { text: string; cursor: number };

export const insertAtCursor = (text: string, cursor: number, insertion: string): CursorEdit => {
  const at = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, at);
  const after = text.slice(at);
  const lead =
    before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after.startsWith("\n") ? "" : "\n";
  const next = `${before}${lead}${insertion}${trail}${after}`;
  return { text: next, cursor: before.length + lead.length + insertion.length + trail.length };
};
