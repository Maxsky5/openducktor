import { z } from "zod";
import { browserTabUrlSchema } from "./browser-tab-schemas";
import { parseBrowserUrl } from "./browser-url-rules";

/**
 * The messages between the frame script of a preview page and the app that shows the page in an
 * iframe. The web runner preview proxy adds the script to each page of a dev server on the host.
 */
export const BROWSER_FRAME_MESSAGE_MARK = "openducktorFrame";
/** The field of an app message that names a command for the frame script. */
export const BROWSER_FRAME_COMMAND_FIELD = "openducktorFrameCommand";

const BROWSER_FRAME_COMMANDS = ["back", "forward", "reload", "stop"] as const;
export type BrowserFrameCommand = (typeof BROWSER_FRAME_COMMANDS)[number];

const frameMark = { [BROWSER_FRAME_MESSAGE_MARK]: z.literal(1) };

export const browserFrameMessageSchema = z.discriminatedUnion("type", [
  /** The page state after each change. URLs name the dev server, not the preview proxy. */
  z.strictObject({
    ...frameMark,
    type: z.literal("state"),
    url: browserTabUrlSchema,
    title: z.string().nullable(),
    favicon: z.string().nullable(),
    canGoBack: z.boolean(),
    canGoForward: z.boolean(),
    /** The proxy could not reach the dev server. */
    error: z.string().nullable(),
  }),
  /** The page starts to load a new document at `url`. */
  z.strictObject({ ...frameMark, type: z.literal("loading"), url: browserTabUrlSchema }),
  /** The page wants to go to a site outside the host. The app loads the site in the frame. */
  z.strictObject({ ...frameMark, type: z.literal("leave"), url: browserTabUrlSchema }),
  /** F6 in the page moves the keyboard focus to the address bar. */
  z.strictObject({ ...frameMark, type: z.literal("focus_address_bar") }),
]);
export type BrowserFrameMessage = z.infer<typeof browserFrameMessageSchema>;

/** True for `localhost`, `.localhost` names, and loopback addresses: the pages of the host itself. */
const isLoopbackBrowserHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    /^127(\.\d{1,3}){3}$/.test(host)
  );
};

/** True for an `http` or `https` URL of the host itself, which a preview frame can show. */
export const isBrowserFrameUrl = (url: string): boolean => {
  const parsed = parseBrowserUrl(url);
  if (parsed === null) return false;
  return (
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    isLoopbackBrowserHost(parsed.hostname)
  );
};

/** How the web runner app shows a page in the iframe of a user tab. */
export const browserFrameSourceSchema = z.discriminatedUnion("kind", [
  /** A page of the host. The frame loads it from this preview origin. */
  z.strictObject({ kind: z.literal("preview"), origin: z.string().min(1) }),
  /** A site that lets other sites frame it. The frame loads its URL. */
  z.strictObject({ kind: z.literal("direct") }),
  /** A site that refuses frames of other sites. */
  z.strictObject({ kind: z.literal("refused"), message: z.string().min(1) }),
]);
export type BrowserFrameSource = z.infer<typeof browserFrameSourceSchema>;
