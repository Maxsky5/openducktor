/**
 * Messages of the terminal page, `page-src/terminal.ts`. The page draws one terminal with xterm.js
 * and sends the user input to the app. The app owns the terminal socket, the attachment, the
 * acknowledgements, and the recovery. This module has no React Native import, so the page bundles it.
 */
import type { AppPlatform } from "@openducktor/contracts";
import type { TerminalTouchKey } from "@openducktor/frontend-core/terminals/terminal-keyboard-policy";
import { z } from "zod";
import { definePageChannel } from "./page-channel";

/** The largest text that one input, paste, or copy message carries. */
export const MAX_TERMINAL_PAGE_TEXT_LENGTH = 4 * 1024 * 1024;
/** Base64 of the 8 MiB terminal frame limit, with room for padding. */
const MAX_TERMINAL_PAGE_BYTES_LENGTH = 12 * 1024 * 1024;

const colorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i, "Use a #rrggbb or #rrggbbaa color.");
const sequenceSchema = z.number().int().nonnegative();
const gridSchema = {
  columns: z.number().int().min(1).max(500),
  rows: z.number().int().min(1).max(300),
};
const bytesSchema = z.string().min(1).max(MAX_TERMINAL_PAGE_BYTES_LENGTH);
const textSchema = z.string().max(MAX_TERMINAL_PAGE_TEXT_LENGTH);

const platformSchema = z.enum(["darwin", "linux", "win32"]) satisfies z.ZodType<AppPlatform>;
const touchKeySchema = z.enum([
  "Escape",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]) satisfies z.ZodType<TerminalTouchKey>;

const terminalPageColorsSchema = z.strictObject({
  background: colorSchema,
  foreground: colorSchema,
  cursor: colorSchema,
  cursorAccent: colorSchema,
  selection: colorSchema,
});
export type TerminalPageColors = z.infer<typeof terminalPageColorsSchema>;

/** One contiguous range of terminal output bytes, in base64. */
const terminalOutputChunkSchema = z
  .strictObject({ sequenceStart: sequenceSchema, sequenceEnd: sequenceSchema, bytes: bytesSchema })
  .refine((chunk) => chunk.sequenceEnd > chunk.sequenceStart, "An output chunk has no bytes.");
export type TerminalOutputChunk = z.infer<typeof terminalOutputChunkSchema>;

const terminalPageInboundSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("terminal_configure"),
    colors: terminalPageColorsSchema,
    /** The CSS font size, which follows the system text size. */
    fontSize: z.number().min(6).max(40),
    /** The host platform for its keyboard shortcuts, or null while it is unknown. */
    platform: platformSchema.nullable(),
    /** False for an exited or lost terminal, and while host commands are closed. */
    inputEnabled: z.boolean(),
    /** Trace output stays quiet until the user requests a text snapshot. */
    screenReaderMode: z.boolean().optional(),
    /** Reports a trace reader's position without changing the PTY. */
    trackViewport: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal("terminal_output"),
    chunks: z.array(terminalOutputChunkSchema).min(1),
  }),
  z.strictObject({ type: z.literal("terminal_snapshot"), sequenceEnd: sequenceSchema }),
  z.strictObject({
    type: z.literal("terminal_restore"),
    sequenceEnd: sequenceSchema,
    ...gridSchema,
    precedingJoinState: z.number().int(),
    bytes: bytesSchema,
  }),
  z.strictObject({
    type: z.literal("terminal_key"),
    key: touchKeySchema,
    ctrl: z.boolean(),
    alt: z.boolean(),
  }),
  z.strictObject({ type: z.literal("terminal_modifiers"), ctrl: z.boolean(), alt: z.boolean() }),
  z.strictObject({ type: z.literal("terminal_paste"), text: textSchema.min(1) }),
  /** The Copy key. The page answers with `terminal_copy` when it has selected text. */
  z.strictObject({ type: z.literal("terminal_copy_selection") }),
  z.strictObject({ type: z.literal("terminal_read_output") }),
  z.strictObject({
    type: z.literal("terminal_set_viewport"),
    row: sequenceSchema,
    follow: z.boolean(),
  }),
  z.strictObject({ type: z.literal("terminal_focus") }),
  z.strictObject({ type: z.literal("terminal_blur") }),
]);
export type TerminalPageInbound = z.infer<typeof terminalPageInboundSchema>;

const terminalPageOutboundSchema = z.discriminatedUnion("type", [
  /** xterm.js opened at the grid that fits the page. */
  z.strictObject({ type: z.literal("terminal_ready"), ...gridSchema }),
  /** The page parsed the output through the attachment snapshot boundary. */
  z.strictObject({ type: z.literal("terminal_hydrated") }),
  /** xterm.js parsed the output through `sequenceEnd`. Only then may the app acknowledge it. */
  z.strictObject({ type: z.literal("terminal_consumed"), sequenceEnd: sequenceSchema }),
  z.strictObject({ type: z.literal("terminal_input"), data: textSchema.min(1) }),
  z.strictObject({ type: z.literal("terminal_resize"), ...gridSchema }),
  /** The selection started or ended. The page sends it only when the value changes. */
  z.strictObject({ type: z.literal("terminal_selection"), hasSelection: z.boolean() }),
  /** The selected text, for the Copy key or a hardware copy shortcut. */
  z.strictObject({ type: z.literal("terminal_copy"), text: textSchema.min(1) }),
  z.strictObject({ type: z.literal("terminal_output_text"), text: textSchema }),
  z.strictObject({
    type: z.literal("terminal_viewport"),
    row: sequenceSchema,
    follow: z.boolean(),
    restored: z.boolean(),
  }),
  /** Typed text used the held touch modifiers. */
  z.strictObject({ type: z.literal("terminal_modifiers_consumed") }),
  z.strictObject({ type: z.literal("terminal_error"), message: z.string().min(1).max(4_000) }),
  z.strictObject({ type: z.literal("link"), url: z.string().max(8_192) }),
]);
export type TerminalPageOutbound = z.infer<typeof terminalPageOutboundSchema>;

export const TERMINAL_PAGE_CHANNEL = definePageChannel(
  terminalPageInboundSchema,
  terminalPageOutboundSchema,
);
