import { z } from "zod";
import {
  BROWSER_FAVICON_MAX_LENGTH,
  BROWSER_TITLE_MAX_LENGTH,
  BROWSER_URL_MAX_LENGTH,
  isBrowserTabLoadableUrl,
} from "./browser-url-rules";
import { workspaceIdSchema } from "./workspace-id-schemas";
import { withMaxUtf16Length } from "./string-schemas";

/** Browser tabs of one task or Workspace Session. Popup windows count, DevTools do not. */
export const BROWSER_TAB_LIMIT = 8;

const nonBlankString = z.string().trim().min(1);

export const browserTabIdSchema = z.uuid();

export const browserUrlSchema = withMaxUtf16Length(z.string(), BROWSER_URL_MAX_LENGTH);

/**
 * A URL that a page reports for its tab. Only `http`, `https`, and the blank page pass: a tab that
 * loads a `javascript:` URL in a web runner frame runs it on the origin of the app.
 */
export const browserTabUrlSchema = browserUrlSchema.refine(isBrowserTabLoadableUrl, {
  message: "A browser tab URL must use http or https, or be about:blank.",
});

/** The task or Workspace Session that owns a tab. The host finds its repository from the workspace. */
export const browserTabOwnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("task"),
    workspaceId: workspaceIdSchema,
    taskId: nonBlankString,
  }),
  z.strictObject({
    kind: z.literal("workspace_session"),
    workspaceId: workspaceIdSchema,
    sessionId: nonBlankString,
  }),
]);
export type BrowserTabOwner = z.infer<typeof browserTabOwnerSchema>;

/** Stable key of one owner. Two owners are the same owner when their keys are equal. */
export const browserTabOwnerKey = (owner: BrowserTabOwner): string =>
  JSON.stringify(
    owner.kind === "task"
      ? [owner.workspaceId, owner.kind, owner.taskId]
      : [owner.workspaceId, owner.kind, owner.sessionId],
  );

export const browserTabCreatorSchema = z.enum(["user", "agent"]);
export type BrowserTabCreator = z.infer<typeof browserTabCreatorSchema>;

const browserEngineKindSchema = z.enum(["electron_webview", "chrome_for_testing"]);
export type BrowserEngineKind = z.infer<typeof browserEngineKindSchema>;

export const browserEngineStateSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("ready"),
    engine: browserEngineKindSchema,
  }),
  z.strictObject({ kind: z.literal("no_window") }),
  z.strictObject({
    kind: z.literal("not_installed"),
    version: nonBlankString,
    downloadBytes: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal("downloading"),
    version: nonBlankString,
    receivedBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().positive(),
  }),
  z.strictObject({ kind: z.literal("verifying"), version: nonBlankString }),
  z.strictObject({
    kind: z.literal("failed"),
    reason: nonBlankString,
    missingLibraries: z.array(nonBlankString),
    /** True when Retry starts a new download. False when the installed browser cannot start. */
    canRetryDownload: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("unsupported_platform"),
    platform: nonBlankString,
    supported: z.array(nonBlankString),
  }),
]);
export type BrowserEngineState = z.infer<typeof browserEngineStateSchema>;

const mebibytes = (bytes: number): number => Math.round(bytes / (1024 * 1024));

/** Why the engine cannot open tabs now, or null when it is ready. */
export const browserEngineNotReadyMessage = (state: BrowserEngineState): string | null => {
  switch (state.kind) {
    case "ready":
      return null;
    case "no_window":
      return "Open the OpenDucktor window to use browser tabs.";
    case "not_installed":
      return "The browser for agent tabs is not installed. The next agent browser tool installs it.";
    case "downloading":
      return `OpenDucktor is downloading the browser for agent tabs (${mebibytes(state.receivedBytes)} of ${mebibytes(state.totalBytes)} MiB). Try again in a minute.`;
    case "verifying":
      return "OpenDucktor is checking the browser download for agent tabs. Try again in a minute.";
    case "failed":
      return state.reason;
    case "unsupported_platform":
      return `Browser tabs are not available on ${state.platform}. Supported platforms: ${state.supported.join(", ")}.`;
  }
};

/** A box in CSS pixels, relative to the top left corner of the page viewport. */
export const browserBoxSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type BrowserBox = z.infer<typeof browserBoxSchema>;

export const BROWSER_PERMISSION_KINDS = [
  "camera",
  "microphone",
  "geolocation",
  "notifications",
  "clipboard_read",
] as const;
export const browserPermissionKindSchema = z.enum(BROWSER_PERMISSION_KINDS);
export type BrowserPermissionKind = z.infer<typeof browserPermissionKindSchema>;

const browserDialogTypeSchema = z.enum(["alert", "confirm", "prompt", "beforeunload"]);
export type BrowserDialogType = z.infer<typeof browserDialogTypeSchema>;

const promptIdSchema = nonBlankString;

const browserPromptSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    promptId: promptIdSchema,
    kind: z.literal("dialog"),
    type: browserDialogTypeSchema,
    message: z.string(),
    defaultPrompt: z.string(),
    /** True when the dialog opened during an agent action. Its card then leaves the focus where it is. */
    startedByAgent: z.boolean(),
  }),
  z.strictObject({
    promptId: promptIdSchema,
    kind: z.literal("permission"),
    origin: nonBlankString,
    permission: browserPermissionKindSchema,
  }),
  z.strictObject({
    promptId: promptIdSchema,
    kind: z.literal("certificate"),
    host: nonBlankString,
    url: browserUrlSchema,
    error: nonBlankString,
  }),
  z.strictObject({
    promptId: promptIdSchema,
    kind: z.literal("file_chooser"),
    multiple: z.boolean(),
    accept: z.array(z.string()),
    startedByAgent: z.boolean(),
  }),
  /** Electron answers `beforeunload` at once and keeps the page. Leave repeats the navigation. */
  z.strictObject({
    promptId: promptIdSchema,
    kind: z.literal("leave_page"),
    url: browserUrlSchema.nullable(),
    /** True when the held navigation came from an agent. Its card then leaves the focus where it is. */
    startedByAgent: z.boolean(),
  }),
]);
export type BrowserPrompt = z.infer<typeof browserPromptSchema>;
export type BrowserPromptKind = BrowserPrompt["kind"];

const browserPromptAnswerSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("dialog"),
    accept: z.boolean(),
    promptText: withMaxUtf16Length(z.string(), 65_536).optional(),
  }),
  z.strictObject({ kind: z.literal("permission"), allow: z.boolean() }),
  z.strictObject({ kind: z.literal("certificate"), proceed: z.boolean() }),
  /** Host file paths. An empty list cancels the chooser and leaves the input unchanged. */
  z.strictObject({
    kind: z.literal("file_chooser"),
    paths: z.array(withMaxUtf16Length(z.string().min(1), 32_768)).max(20),
  }),
  z.strictObject({ kind: z.literal("leave_page"), leave: z.boolean() }),
]);
export type BrowserPromptAnswer = z.infer<typeof browserPromptAnswerSchema>;

const browserDownloadStateSchema = z.enum(["in_progress", "completed", "failed", "canceled"]);
export type BrowserDownloadState = z.infer<typeof browserDownloadStateSchema>;

const browserDownloadSchema = z.strictObject({
  downloadId: nonBlankString,
  url: browserUrlSchema,
  fileName: nonBlankString,
  state: browserDownloadStateSchema,
  receivedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
});
export type BrowserDownload = z.infer<typeof browserDownloadSchema>;

const browserTabErrorSchema = z.strictObject({
  /** `frame_refused`: the site refuses frames, so a web runner tab cannot show it. */
  kind: z.enum(["load_failed", "crashed", "frame_refused"]),
  url: browserUrlSchema,
  message: nonBlankString,
});
export type BrowserTabError = z.infer<typeof browserTabErrorSchema>;

const browserTabSurfaceSchema = z.enum(["panel", "popup_window"]);
export type BrowserTabSurface = z.infer<typeof browserTabSurfaceSchema>;

/**
 * Where the page of a tab runs. `host`: in the browser engine of the host. `frame`: in an iframe of
 * the web runner app, which reports the page state with `browser_tab_frame_state`. The web runner
 * shows user tabs in frames. Its agent tabs and all Electron tabs run on the host.
 */
const browserTabPageSchema = z.enum(["host", "frame"]);
export type BrowserTabPage = z.infer<typeof browserTabPageSchema>;

/**
 * Tab state. The host saves the URL, title, creator, and sharing state of each tab, so the tab comes
 * back after a restart. The other fields are live state.
 */
export const browserTabSummarySchema = z.strictObject({
  tabId: browserTabIdSchema,
  /** Grows with each change of the tab, so a client keeps the newest summary. */
  revision: z.number().int().positive(),
  owner: browserTabOwnerSchema,
  createdBy: browserTabCreatorSchema,
  /** User tabs only. Agent tabs are always usable by the agents of their owner. */
  shared: z.boolean(),
  openerTabId: browserTabIdSchema.nullable(),
  surface: browserTabSurfaceSchema,
  page: browserTabPageSchema,
  /**
   * Host pages only. False for a saved tab of an earlier run, which has no page yet. A client that
   * shows the tab, or an agent that uses it, starts it. Always false for a frame page.
   */
  started: z.boolean(),
  /** False until the engine attaches the page. */
  live: z.boolean(),
  url: browserUrlSchema,
  title: z.string().nullable(),
  /** A `data:` image URL, so a remote client can show it. */
  favicon: z.string().max(BROWSER_FAVICON_MAX_LENGTH).nullable(),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  error: browserTabErrorSchema.nullable(),
  prompts: z.array(browserPromptSchema),
  downloads: z.array(browserDownloadSchema),
  agentActive: z.boolean(),
});
export type BrowserTabSummary = z.infer<typeof browserTabSummarySchema>;

const browserNoticeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("scheme_refused"), scheme: nonBlankString }),
  z.strictObject({ kind: z.literal("popup_limit"), limit: z.number().int().positive() }),
  z.strictObject({
    kind: z.literal("page_notification"),
    origin: nonBlankString,
    title: z.string(),
    body: z.string(),
  }),
]);
export type BrowserNotice = z.infer<typeof browserNoticeSchema>;

export const browserHostEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("tab_upserted"), tab: browserTabSummarySchema }),
  z.strictObject({
    type: z.literal("tab_closed"),
    tabId: browserTabIdSchema,
    owner: browserTabOwnerSchema,
  }),
  z.strictObject({ type: z.literal("engine_changed"), state: browserEngineStateSchema }),
  /** The host could not save the tab list. The tabs work, but they do not come back after a restart. */
  z.strictObject({ type: z.literal("tabs_not_saved"), message: nonBlankString }),
  z.strictObject({
    type: z.literal("notice"),
    tabId: browserTabIdSchema,
    owner: browserTabOwnerSchema,
    notice: browserNoticeSchema,
  }),
]);
export type BrowserHostEvent = z.infer<typeof browserHostEventSchema>;

const browserFailureCodeSchema = z.enum([
  "browser_invalid_input",
  "browser_invalid_address",
  "browser_scheme_refused",
  "browser_tab_not_found",
  "browser_download_not_found",
  "browser_tab_limit",
  "browser_owner_unavailable",
  "browser_not_ready",
  "browser_no_window",
  "browser_unsupported",
  "browser_certificate_error",
  "browser_not_shared",
  "browser_not_closable",
  "browser_ref_stale",
  "browser_no_dialog",
  "browser_prompt_not_found",
  "browser_timeout",
  "browser_unmanaged_caller",
  "browser_action_failed",
  "browser_engine_error",
  "browser_install_failed",
  "protocol_error",
  "message_too_large",
  "outbound_queue_overflow",
]);
export type BrowserFailureCode = z.infer<typeof browserFailureCodeSchema>;

export const browserFailureSchema = z.strictObject({
  code: browserFailureCodeSchema,
  message: nonBlankString,
  tabId: browserTabIdSchema.optional(),
  details: z.record(z.string(), z.json()).optional(),
});
export type BrowserFailure = z.infer<typeof browserFailureSchema>;

export const browserTabRefSchema = z.strictObject({ tabId: browserTabIdSchema });
export type BrowserTabRef = z.infer<typeof browserTabRefSchema>;

export const browserTabsListResponseSchema = z.strictObject({
  tabs: z.array(browserTabSummarySchema),
});
export type BrowserTabsListResponse = z.infer<typeof browserTabsListResponseSchema>;

export const browserTabOpenRequestSchema = z.strictObject({
  owner: browserTabOwnerSchema,
  /** A new ID from the client, so the panel can place the tab before the host replies. */
  tabId: browserTabIdSchema,
  /** Raw address bar text. `null` opens a blank tab. */
  address: withMaxUtf16Length(z.string(), BROWSER_URL_MAX_LENGTH).nullable(),
});
export type BrowserTabOpenRequest = z.infer<typeof browserTabOpenRequestSchema>;

/** The page state of a tab that a client shows in a frame. The host saves the URL and title. */
export const browserTabFrameStateRequestSchema = z.strictObject({
  tabId: browserTabIdSchema,
  url: browserTabUrlSchema,
  title: z.string().max(BROWSER_TITLE_MAX_LENGTH).nullable(),
  favicon: z.string().max(BROWSER_FAVICON_MAX_LENGTH).nullable(),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  error: browserTabErrorSchema.nullable(),
});
export type BrowserTabFrameStateRequest = z.infer<typeof browserTabFrameStateRequestSchema>;

const browserNavigationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("address"),
    address: withMaxUtf16Length(z.string(), BROWSER_URL_MAX_LENGTH),
  }),
  z.strictObject({ kind: z.literal("back") }),
  z.strictObject({ kind: z.literal("forward") }),
  z.strictObject({ kind: z.literal("reload") }),
  z.strictObject({ kind: z.literal("stop") }),
]);
export type BrowserNavigation = z.infer<typeof browserNavigationSchema>;

export const browserTabNavigateRequestSchema = z.strictObject({
  tabId: browserTabIdSchema,
  navigation: browserNavigationSchema,
});
export type BrowserTabNavigateRequest = z.infer<typeof browserTabNavigateRequestSchema>;

export const browserTabSetSharedRequestSchema = z.strictObject({
  tabId: browserTabIdSchema,
  shared: z.boolean(),
});
export type BrowserTabSetSharedRequest = z.infer<typeof browserTabSetSharedRequestSchema>;

export const browserPromptAnswerRequestSchema = z.strictObject({
  tabId: browserTabIdSchema,
  promptId: promptIdSchema,
  answer: browserPromptAnswerSchema,
});
export type BrowserPromptAnswerRequest = z.infer<typeof browserPromptAnswerRequestSchema>;

export const browserPermissionDecisionSchema = z.enum(["granted", "denied"]);
export type BrowserPermissionDecision = z.infer<typeof browserPermissionDecisionSchema>;

export const browserSitePermissionsRequestSchema = z.strictObject({
  /** The ID names a folder of the workspace browser data, so it must be a workspace ID. */
  workspaceId: workspaceIdSchema,
  origin: nonBlankString,
});
export type BrowserSitePermissionsRequest = z.infer<typeof browserSitePermissionsRequestSchema>;

export const browserSitePermissionsResponseSchema = z.strictObject({
  origin: nonBlankString,
  permissions: z.array(
    z.strictObject({
      permission: browserPermissionKindSchema,
      decision: browserPermissionDecisionSchema,
    }),
  ),
});
export type BrowserSitePermissionsResponse = z.infer<typeof browserSitePermissionsResponseSchema>;

export const browserSitePermissionsResetRequestSchema = browserSitePermissionsRequestSchema.extend({
  /** `null` resets every saved choice of the origin. */
  permission: browserPermissionKindSchema.nullable(),
});
export type BrowserSitePermissionsResetRequest = z.infer<
  typeof browserSitePermissionsResetRequestSchema
>;

export const browserPickerSetRequestSchema = z.strictObject({
  tabId: browserTabIdSchema,
  enabled: z.boolean(),
});
export type BrowserPickerSetRequest = z.infer<typeof browserPickerSetRequestSchema>;

export const BROWSER_ANNOTATION_MAX_ELEMENTS = 20;

export const browserNodeRefSchema = withMaxUtf16Length(nonBlankString, 128);

export const browserAnnotationCaptureRequestSchema = z.strictObject({
  tabId: browserTabIdSchema,
  nodeRefs: z.array(browserNodeRefSchema).min(1).max(BROWSER_ANNOTATION_MAX_ELEMENTS),
});
export type BrowserAnnotationCaptureRequest = z.infer<typeof browserAnnotationCaptureRequestSchema>;

const browserSourceLocationSchema = z.strictObject({
  path: nonBlankString,
  line: z.number().int().positive(),
  column: z.number().int().positive().nullable(),
});

export const browserAnnotationElementSchema = z.strictObject({
  /** The tag name, for example `button`. */
  tag: nonBlankString,
  /** The text of the element on one line, cut short. */
  text: z.string(),
  /** The opening tag with its attributes, cut short. */
  openingTag: nonBlankString,
  selector: nonBlankString,
  /** The names of the React components that hold the element, nearest first. */
  componentChain: z.array(nonBlankString).nullable(),
  source: browserSourceLocationSchema.nullable(),
  accessible: z.strictObject({ role: z.string(), name: z.string() }).nullable(),
});
export type BrowserAnnotationElement = z.infer<typeof browserAnnotationElementSchema>;

const browserAnnotationImageSchema = z.strictObject({
  path: nonBlankString,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const browserAnnotationCaptureSchema = z.strictObject({
  page: z.strictObject({ url: browserUrlSchema, title: z.string() }),
  selectedText: z.string().nullable(),
  elements: z.array(browserAnnotationElementSchema).min(1),
  image: browserAnnotationImageSchema.nullable(),
});
export type BrowserAnnotationCapture = z.infer<typeof browserAnnotationCaptureSchema>;

export const browserDownloadRefSchema = z.strictObject({
  tabId: browserTabIdSchema,
  downloadId: nonBlankString,
});
export type BrowserDownloadRef = z.infer<typeof browserDownloadRefSchema>;

export const browserDevToolsOpenResponseSchema = z.strictObject({
  frontendUrl: nonBlankString,
});
export type BrowserDevToolsOpenResponse = z.infer<typeof browserDevToolsOpenResponseSchema>;
