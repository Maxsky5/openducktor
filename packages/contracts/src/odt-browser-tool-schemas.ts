import { z } from "zod";
import { browserTabIdSchema } from "./browser-tab-schemas";
import { BROWSER_URL_MAX_LENGTH } from "./browser-url-rules";
import { odtToolWorkspaceIdSchema } from "./odt-tool-workspace-id-schema";
import { withMaxUtf16Length } from "./string-schemas";

/** Browser tools of managed agent sessions. External MCP clients do not get them. */
export const ODT_BROWSER_TOOL_NAMES = [
  "odt_browser_list",
  "odt_browser_open",
  "odt_browser_navigate",
  "odt_browser_close",
  "odt_browser_snapshot",
  "odt_browser_click",
  "odt_browser_hover",
  "odt_browser_type",
  "odt_browser_press",
  "odt_browser_select",
  "odt_browser_scroll",
  "odt_browser_screenshot",
  "odt_browser_console",
  "odt_browser_wait",
  "odt_browser_dialog",
] as const;
export type OdtBrowserToolName = (typeof ODT_BROWSER_TOOL_NAMES)[number];

/** Browser tools that change no page. */
export const ODT_BROWSER_READ_TOOL_NAMES = [
  "odt_browser_list",
  "odt_browser_snapshot",
  "odt_browser_screenshot",
  "odt_browser_console",
  "odt_browser_wait",
] as const satisfies readonly OdtBrowserToolName[];

const browserToolNameSet = new Set<string>(ODT_BROWSER_TOOL_NAMES);
export const isOdtBrowserToolName = (value: string): value is OdtBrowserToolName =>
  browserToolNameSet.has(value);

/** Each browser tool call ends within this time, including a wait. */
export const ODT_BROWSER_TOOL_TIMEOUT_MS = 30_000;
export const ODT_BROWSER_WAIT_DEFAULT_TIMEOUT_MS = 10_000;
/** The MCP server waits this long for the host, a little longer than the host limit. */
export const ODT_BROWSER_BRIDGE_TIMEOUT_MS = 35_000;

const tabIdSchema = browserTabIdSchema.describe("From odt_browser_list or odt_browser_open.");
const refSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .describe("Ref from the latest odt_browser_snapshot, such as e12.");
const urlSchema = withMaxUtf16Length(z.string().trim().min(1), BROWSER_URL_MAX_LENGTH);

const browserConsoleLevelSchema = z.enum(["error", "warning", "info", "log", "debug"]);
const browserWaitLoadStateSchema = z.enum(["load", "domcontentloaded", "networkidle"]);
const WAIT_CONDITION_KEYS = ["text", "ref", "url", "load"] as const;

/** What `odt_browser_wait` waits for. With no condition in the input, it waits for `load`. */
export type BrowserWaitCondition =
  | { text: string }
  | { ref: string }
  | { url: string }
  | { load: z.infer<typeof browserWaitLoadStateSchema> };

export const browserWaitCondition = (
  input: Pick<OdtBrowserToolInput<"odt_browser_wait">, (typeof WAIT_CONDITION_KEYS)[number]>,
): BrowserWaitCondition => {
  if (input.text !== undefined) return { text: input.text };
  if (input.ref !== undefined) return { ref: input.ref };
  if (input.url !== undefined) return { url: input.url };
  return { load: input.load ?? "load" };
};
export type BrowserConsoleLevel = z.infer<typeof browserConsoleLevelSchema>;

export const ODT_BROWSER_TOOL_SCHEMAS = {
  odt_browser_list: z.strictObject({ workspaceId: odtToolWorkspaceIdSchema }),
  odt_browser_open: z.strictObject({
    workspaceId: odtToolWorkspaceIdSchema,
    url: urlSchema.describe("Without a scheme, local hosts use http and others use https."),
  }),
  odt_browser_navigate: z
    .strictObject({
      workspaceId: odtToolWorkspaceIdSchema,
      tabId: tabIdSchema,
      url: urlSchema.optional(),
      action: z.enum(["back", "forward", "reload"]).optional(),
    })
    .refine((input) => (input.url === undefined) !== (input.action === undefined), {
      message: "Give either url or action, not both and not neither.",
    }),
  odt_browser_close: z.strictObject({
    workspaceId: odtToolWorkspaceIdSchema,
    tabId: tabIdSchema,
  }),
  odt_browser_snapshot: z.strictObject({
    workspaceId: odtToolWorkspaceIdSchema,
    tabId: tabIdSchema,
  }),
  odt_browser_click: z.strictObject({
    workspaceId: odtToolWorkspaceIdSchema,
    tabId: tabIdSchema,
    ref: refSchema,
    button: z.enum(["left", "right", "middle"]).optional(),
    doubleClick: z.boolean().optional(),
    modifiers: z
      .array(z.enum(["Alt", "Control", "Meta", "Shift"]))
      .max(4)
      .optional(),
  }),
  odt_browser_hover: z.strictObject({
    workspaceId: odtToolWorkspaceIdSchema,
    tabId: tabIdSchema,
    ref: refSchema,
  }),
  odt_browser_type: z.strictObject({
    workspaceId: odtToolWorkspaceIdSchema,
    tabId: tabIdSchema,
    ref: refSchema,
    text: withMaxUtf16Length(z.string(), 65_536),
    submit: z.boolean().optional().describe("Press Enter after the text."),
  }),
  odt_browser_press: z.strictObject({
    workspaceId: odtToolWorkspaceIdSchema,
    tabId: tabIdSchema,
    key: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .describe("Such as Enter, Escape, ArrowDown, or Control+a."),
  }),
  odt_browser_select: z.strictObject({
    workspaceId: odtToolWorkspaceIdSchema,
    tabId: tabIdSchema,
    ref: refSchema,
    values: z.array(z.string().max(4_096)).min(1).max(100).describe("Values or labels."),
  }),
  odt_browser_scroll: z
    .strictObject({
      workspaceId: odtToolWorkspaceIdSchema,
      tabId: tabIdSchema,
      ref: refSchema.optional().describe("Element to scroll into view. Omit to scroll the page."),
      deltaX: z.number().min(-100_000).max(100_000).optional(),
      deltaY: z.number().min(-100_000).max(100_000).optional(),
    })
    .refine(
      (input) => input.ref !== undefined || (input.deltaX ?? 0) !== 0 || (input.deltaY ?? 0) !== 0,
      { message: "Give a ref, or deltaX or deltaY." },
    ),
  odt_browser_screenshot: z.strictObject({
    workspaceId: odtToolWorkspaceIdSchema,
    tabId: tabIdSchema,
    ref: refSchema.optional().describe("Element to capture. Omit for the visible page."),
  }),
  odt_browser_console: z.strictObject({
    workspaceId: odtToolWorkspaceIdSchema,
    tabId: tabIdSchema,
    levels: z.array(browserConsoleLevelSchema).min(1).max(5).optional(),
    afterSequence: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Return only entries after this sequence number."),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  odt_browser_wait: z
    .strictObject({
      workspaceId: odtToolWorkspaceIdSchema,
      tabId: tabIdSchema,
      text: z.string().min(1).max(4_096).optional(),
      ref: refSchema.optional(),
      url: urlSchema.optional().describe("URL or glob such as **/settings."),
      load: browserWaitLoadStateSchema.optional(),
      timeoutMs: z.number().int().min(1).max(ODT_BROWSER_TOOL_TIMEOUT_MS).optional(),
    })
    .refine((input) => WAIT_CONDITION_KEYS.filter((key) => input[key] !== undefined).length <= 1, {
      message: "Give at most one of text, ref, url, or load.",
    }),
  odt_browser_dialog: z.strictObject({
    workspaceId: odtToolWorkspaceIdSchema,
    tabId: tabIdSchema,
    accept: z.boolean(),
    promptText: withMaxUtf16Length(z.string(), 65_536).optional(),
  }),
} as const satisfies Record<OdtBrowserToolName, z.ZodType>;

export type OdtBrowserToolInput<Name extends OdtBrowserToolName> = z.infer<
  (typeof ODT_BROWSER_TOOL_SCHEMAS)[Name]
>;

export const odtBrowserCallerSchema = z.strictObject({
  runtime: z.enum(["opencode", "codex", "claude"]),
  runtimeSessionId: z.string().trim().min(1).max(512),
});
export type OdtBrowserCaller = z.infer<typeof odtBrowserCallerSchema>;

/** The host returns content blocks. Only the MCP adapter turns them into MCP content. */
export const odtBrowserToolResultSchema = z.strictObject({
  content: z
    .array(
      z.discriminatedUnion("type", [
        z.strictObject({ type: z.literal("text"), text: z.string() }),
        z.strictObject({
          type: z.literal("image"),
          mimeType: z.enum(["image/png", "image/jpeg"]),
          dataBase64: z.string().min(1),
        }),
      ]),
    )
    .min(1),
});
export type OdtBrowserToolResult = z.infer<typeof odtBrowserToolResultSchema>;
