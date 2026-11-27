/**
 * The content policy of a published HTML page on every client. The page runs in a sandboxed frame
 * without `allow-same-origin`, so it has an opaque origin. The bootstrap adds the sandbox
 * directive to its response header; a CSP meta tag cannot carry a sandbox directive.
 */
export const HTML_PREVIEW_CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https: data: blob:; style-src 'unsafe-inline' https: data: blob:; img-src https: data: blob:; font-src https: data:; media-src https: data: blob:; connect-src https:; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri about: https:; form-action 'none'";

/** The sandbox flags of a published page frame. No frame between the app and the page adds more. */
export const HTML_PREVIEW_SANDBOX = "allow-scripts allow-forms";

/** The message that a published page sends to its bootstrap parent to report its content height. */
export const HTML_PREVIEW_RESIZE_MESSAGE = "odt-html-preview-resize" as const;

/** The message that updates the theme of a mounted published page. */
export const HTML_PREVIEW_THEME_MESSAGE = "odt-html-preview-theme" as const;

/** The message that a published page sends on a trusted external link click. */
export const HTML_PREVIEW_OPEN_LINK_MESSAGE = "odt-html-preview-open-link" as const;

/** The message that a full-screen published page sends when the reader presses Escape. */
export const HTML_PREVIEW_ESCAPE_MESSAGE = "odt-html-preview-escape" as const;

/** The inline page fits its content between these heights, in CSS pixels. */
export const HTML_PREVIEW_MIN_CONTENT_HEIGHT = 80;
export const HTML_PREVIEW_MAX_CONTENT_HEIGHT = 20_000;
/** Inline previews on mobile fit up to this height in points before full screen handles overflow. */
export const HTML_PREVIEW_MOBILE_MAX_INLINE_HEIGHT = 2_000;

/**
 * The restore limits that stop a page which navigates away on every load. Both the desktop
 * bootstrap and the mobile wrapper apply these values.
 */
export const HTML_PREVIEW_RESTORE_LIMITS = {
  /** Restores allowed in one window before the viewer stops an immediate loop. */
  perWindow: 3,
  /** Length of the restore window in milliseconds. */
  windowMs: 1000,
  /** Restores allowed in one viewer generation before the viewer stops a slow loop. */
  perGeneration: 5,
} as const;

export type HtmlPreviewHostControllerOptions = {
  /** Maximum reported content height in CSS pixels / points. */
  maxContentHeight: number;
  /** Whether to forward trusted Escape notifications from the inner frame. */
  forwardEscape?: boolean;
  /**
   * Whether the wrapper itself must verify active user activation before forwarding `open-link`.
   * Mobile enables this so untrusted HTML cannot launch external URLs without a user tap.
   */
  requireUserActivationForLinks?: boolean;
  /**
   * Whether to disable scrolling on the inner `<iframe>` element (`scrolling="no"`). Mobile inline
   * previews set this so iOS WKWebView never attaches a child scroll view that traps vertical
   * transcript swipes on tall previews.
   */
  disableFrameScrolling?: boolean;
};

/**
 * Builds the inline controller helper shared by the desktop/web bootstrap document and the mobile
 * WebView wrapper. The controller mounts one sandboxed `srcdoc` frame, enforces the restore loop
 * circuit breaker across load and CSP `frame-src` events, pushes live theme updates, and validates
 * messages from the mounted page frame before handing them to the host transport.
 */
export const buildHtmlPreviewHostControllerScript = ({
  maxContentHeight,
  forwardEscape = false,
  requireUserActivationForLinks = false,
  disableFrameScrolling = false,
}: HtmlPreviewHostControllerOptions): string => {
  const { perWindow, windowMs, perGeneration } = HTML_PREVIEW_RESTORE_LIMITS;
  const escapeBranch = forwardEscape
    ? `if (data.type === "${HTML_PREVIEW_ESCAPE_MESSAGE}") { onEvent({ type: "escape" }); }`
    : "";
  const linkActivationGuard = requireUserActivationForLinks
    ? "if (!navigator.userActivation || !navigator.userActivation.isActive) return;"
    : "";
  const frameScrolling = disableFrameScrolling ? '\n    frame.scrolling = "no";' : "";
  return `const createHtmlPreviewController = ({ onEvent, onFail, getFrameBackground }) => {
  let html = null;
  let current = null;
  let failed = false;
  let stopped = false;
  let themeCss = null;
  let windowRestores = 0;
  let restoreWindow = 0;
  let restores = 0;
  const applyTheme = () => {
    if (stopped || failed || !current || !current.contentWindow || themeCss === null) return;
    const background = getFrameBackground ? getFrameBackground() : undefined;
    if (typeof background === "string") current.style.background = background;
    current.contentWindow.postMessage({ type: "${HTML_PREVIEW_THEME_MESSAGE}", css: themeCss }, "*");
  };
  const mount = () => {
    const frame = document.createElement("iframe");
    frame.sandbox = "${HTML_PREVIEW_SANDBOX}";${frameScrolling}
    frame.referrerPolicy = "no-referrer";
    frame.title = "Published HTML";
    const background = getFrameBackground ? getFrameBackground() : undefined;
    if (typeof background === "string") frame.style.background = background;
    // A new document in the page frame, after the published one, comes from navigation. Put
    // the published document back.
    let published = false;
    frame.addEventListener("load", () => {
      if (stopped || failed || frame !== current) return;
      if (!published) { published = true; applyTheme(); return; }
      recover();
    });
    frame.srcdoc = html;
    return frame;
  };
  // A page that navigates away on every load runs the same navigation after each restore.
  // The window limit stops an immediate loop, and the generation limit stops a slow loop that
  // waits out each window. Then the page cannot stay open, so remove it and tell the app to
  // show its preview error.
  const fail = () => {
    if (stopped || failed) return;
    failed = true;
    if (current) { current.remove(); current = null; }
    onFail();
  };
  const recover = () => {
    if (stopped || failed || !current) return;
    const now = Date.now();
    if (now - restoreWindow >= ${windowMs}) { restoreWindow = now; windowRestores = 0; }
    windowRestores += 1;
    restores += 1;
    if (windowRestores > ${perWindow} || restores > ${perGeneration}) { fail(); return; }
    const previous = current;
    const next = mount();
    current = next;
    previous.replaceWith(next);
  };
  // CSP3 strips fragments from event.documentURI on HTTP(S), and reports non-HTTP(S) URLs as
  // their scheme alone (for example Electron's custom protocol). Match the fragment-stripped URL
  // as well as the full URL and non-HTTP(S) scheme form.
  const wrapperUrl = document.URL.split("#", 1)[0];
  const isWrapperDocument = (reported) => {
    if (reported === document.URL || reported === wrapperUrl) return true;
    const protocol = new URL(document.URL).protocol;
    return protocol !== "http:" && protocol !== "https:" && reported === protocol.slice(0, -1);
  };
  const handleViolation = (event) => {
    if (event.effectiveDirective === "frame-src" && isWrapperDocument(event.documentURI)) {
      recover();
    }
  };
  const handleMessage = (event) => {
    if (stopped || failed || !current || event.source !== current.contentWindow) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "${HTML_PREVIEW_RESIZE_MESSAGE}") {
      const height = data.height;
      if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) return;
      onEvent({
        type: "resize",
        height: Math.min(Math.ceil(height), ${maxContentHeight}),
      });
      return;
    }
    if (data.type === "${HTML_PREVIEW_OPEN_LINK_MESSAGE}") {
      ${linkActivationGuard}
      const rawUrl = data.url;
      if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > 4096) return;
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
        onEvent({ type: "open-link", url: parsed.href });
      } catch {}
      return;
    }
    ${escapeBranch}
  };
  addEventListener("securitypolicyviolation", handleViolation);
  addEventListener("message", handleMessage);
  return {
    render: (nextHtml) => {
      if (stopped || failed || html !== null || typeof nextHtml !== "string") return false;
      html = nextHtml;
      current = mount();
      document.body.append(current);
      applyTheme();
      return true;
    },
    setTheme: (nextCss) => {
      if (typeof nextCss !== "string") return;
      themeCss = nextCss;
      applyTheme();
    },
    stop: () => {
      stopped = true;
      removeEventListener("securitypolicyviolation", handleViolation);
      removeEventListener("message", handleMessage);
      if (current) { current.remove(); current = null; }
    },
  };
};`;
};
