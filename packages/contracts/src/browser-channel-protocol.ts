import { z } from "zod";
import { browserForwardedShortcutIdSchema } from "./browser-shortcuts";
import {
  browserBoxSchema,
  browserFailureSchema,
  browserNodeRefSchema,
  browserTabIdSchema,
} from "./browser-tab-schemas";
import { withMaxUtf16Length } from "./string-schemas";

/** The largest encoded message, in bytes, in each direction. */
const BROWSER_CHANNEL_MAX_MESSAGE_BYTES = 256 * 1024;

const coordinateSchema = z.number();

const browserAnnotationAnchorSchema = z.strictObject({
  annotationId: z.string().min(1).max(128),
  selectors: z
    .array(withMaxUtf16Length(z.string().min(1), 4_096))
    .min(1)
    .max(20),
});
export type BrowserAnnotationAnchor = z.infer<typeof browserAnnotationAnchorSchema>;

const browserClientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("picker_hover"),
    tabId: browserTabIdSchema,
    x: coordinateSchema,
    y: coordinateSchema,
  }),
  z.strictObject({
    type: z.literal("anchors"),
    tabId: browserTabIdSchema,
    anchors: z.array(browserAnnotationAnchorSchema).max(200),
  }),
  /** Scrolls the page to the first element of an anchor that the client sent. */
  z.strictObject({
    type: z.literal("reveal_anchor"),
    tabId: browserTabIdSchema,
    annotationId: browserAnnotationAnchorSchema.shape.annotationId,
  }),
]);
export type BrowserClientMessage = z.infer<typeof browserClientMessageSchema>;

const browserAgentMarkerActionSchema = z.enum(["click", "hover", "type"]);
export type BrowserAgentMarkerAction = z.infer<typeof browserAgentMarkerActionSchema>;

const browserServerMessageSchema = z.discriminatedUnion("type", [
  /** The element at the point of a `picker_hover`, which names the same point. */
  z.strictObject({
    type: z.literal("picker_target"),
    tabId: browserTabIdSchema,
    x: coordinateSchema,
    y: coordinateSchema,
    target: z
      .strictObject({
        nodeRef: browserNodeRefSchema,
        box: browserBoxSchema,
        label: z.string().min(1),
      })
      .nullable(),
  }),
  z.strictObject({
    type: z.literal("anchor_boxes"),
    tabId: browserTabIdSchema,
    boxes: z.array(
      z.strictObject({
        annotationId: z.string().min(1),
        box: browserBoxSchema.nullable(),
      }),
    ),
  }),
  z.strictObject({
    type: z.literal("agent_marker"),
    tabId: browserTabIdSchema,
    action: browserAgentMarkerActionSchema,
    x: coordinateSchema,
    y: coordinateSchema,
  }),
  /**
   * Electron only. While `pressing` is true, an agent mouse press runs in the tab. A press moves
   * the window focus to its `<webview>`, so the renderer gives the focus back to the element that
   * the user had focused.
   */
  z.strictObject({
    type: z.literal("agent_press"),
    tabId: browserTabIdSchema,
    pressing: z.boolean(),
  }),
  z.strictObject({ type: z.literal("shortcut"), shortcut: browserForwardedShortcutIdSchema }),
  /**
   * Electron only. While `awake` is true, an agent or DevTools uses the tab, so a hidden
   * `<webview>` must stay drawn (for example with `opacity: 0`) instead of `visibility: hidden`.
   */
  z.strictObject({
    type: z.literal("surface_wake"),
    tabId: browserTabIdSchema,
    awake: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("protocol_error"),
    tabId: browserTabIdSchema.optional(),
    failure: browserFailureSchema,
  }),
]);
export type BrowserServerMessage = z.infer<typeof browserServerMessageSchema>;

export type BrowserChannelMessage = BrowserClientMessage | BrowserServerMessage;

/** Encodes one channel message as UTF-8 JSON. */
export const encodeBrowserChannelMessage = (message: BrowserChannelMessage): Uint8Array => {
  const bytes = new TextEncoder().encode(JSON.stringify(message));
  if (bytes.byteLength > BROWSER_CHANNEL_MAX_MESSAGE_BYTES) {
    throw new Error("Browser channel message exceeds the 256 KiB message limit.");
  }
  return bytes;
};

const decodeText = (bytes: Uint8Array): string => {
  if (bytes.byteLength > BROWSER_CHANNEL_MAX_MESSAGE_BYTES) {
    throw new Error("Browser channel message exceeds the 256 KiB message limit.");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
};

export const decodeBrowserClientMessage = (bytes: Uint8Array): BrowserClientMessage =>
  browserClientMessageSchema.parse(JSON.parse(decodeText(bytes)));

export const decodeBrowserServerMessage = (bytes: Uint8Array): BrowserServerMessage =>
  browserServerMessageSchema.parse(JSON.parse(decodeText(bytes)));
