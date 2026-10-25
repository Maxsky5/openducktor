/**
 * Messages of the block pages, `page-src/rich-block.ts` and `page-src/rich-diagram.ts`. Each
 * renders one Markdown block with math or Mermaid. The page draws only with the colors, text
 * metrics, and look in `block_render`, so it matches the native Markdown around it.
 */
import { z } from "zod";
import { definePageChannel } from "./page-channel";

/** The longest Markdown that one block page renders. */
export const MAX_BLOCK_MARKDOWN_LENGTH = 200_000;
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
/** The longest PNG data URL of a diagram picture. */
export const MAX_SNAPSHOT_LENGTH = 8_000_000;
const pointSchema = z.number().nonnegative().max(100_000);
const renderIdSchema = z.number().int().nonnegative();

const colorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i, "Use a #rrggbb or #rrggbbaa color.");

const blockPageColorsSchema = z.strictObject({
  /** The screen background. Diagrams use it for edge labels; the page itself stays transparent. */
  background: colorSchema,
  /** The text: the foreground, or the muted foreground in a muted text. */
  label: colorSchema,
  /** Link underlines, image alt text, and diagram lines. */
  secondaryLabel: colorSchema,
  /** Links and code blocks, which keep the foreground in a muted text. */
  foreground: colorSchema,
  /** Inline code. */
  code: colorSchema,
  /** Rules, quote bars, and code block borders. */
  separator: colorSchema,
  /** Ordered list numbers and bullets. */
  listNumber: colorSchema,
  listBullet: colorSchema,
  /** The rules between table rows and under the table header. */
  tableRule: colorSchema,
  tableHeaderRule: colorSchema,
  /** The borders of diagram nodes. */
  tint: colorSchema,
  /** Diagram groups and notes. */
  fill: colorSchema,
  /** Code blocks, quotes, and diagram nodes. */
  codeBackground: colorSchema,
  /** A formula that KaTeX cannot read. */
  error: colorSchema,
});

const blockRenderMessageSchema = z.strictObject({
  type: z.literal("block_render"),
  /** Counts the render messages of one page view, so the view can match a render error. */
  id: renderIdSchema,
  markdown: z.string().max(MAX_BLOCK_MARKDOWN_LENGTH),
  theme: z.enum(["light", "dark"]),
  colors: blockPageColorsSchema,
  /** The Markdown variant, which sets the heading, code, and table sizes and the gaps. */
  variant: z.enum(["document", "compact"]),
  /** The body text size and line height of the variant at the default text size, in points. */
  fontSize: z.number().min(8).max(40),
  lineHeight: z.number().min(8).max(60),
  /** Slants the prose but not the code, as the native italic Markdown. */
  italic: z.boolean(),
  /** The system font scale, so page text follows the system text size. */
  fontScale: z.number().min(0.5).max(4),
});
export type BlockRenderMessage = z.infer<typeof blockRenderMessageSchema>;

const blockPageOutboundSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("block_size"), height: z.number().nonnegative().max(100_000) }),
  /**
   * A render or page failure. A render failure has the `id` of its render message; the view
   * ignores it when it sent a newer message. A page script failure has no `id`.
   */
  z.strictObject({
    type: z.literal("block_error"),
    id: renderIdSchema.optional(),
    message: z.string().min(1).max(4_000),
  }),
  /**
   * A PNG of a block that is one diagram, at the screen pixel density, and its place in the block
   * in points. The app shows it again without a page.
   */
  z.strictObject({
    type: z.literal("block_snapshot"),
    image: z.string().startsWith(PNG_DATA_URL_PREFIX).max(MAX_SNAPSHOT_LENGTH),
    x: pointSchema,
    y: pointSchema,
    width: pointSchema,
    height: pointSchema,
  }),
  z.strictObject({ type: z.literal("link"), url: z.string().max(8_192) }),
]);
export type BlockPageOutboundMessage = z.infer<typeof blockPageOutboundSchema>;

export const BLOCK_PAGE_CHANNEL = definePageChannel(
  blockRenderMessageSchema,
  blockPageOutboundSchema,
);
