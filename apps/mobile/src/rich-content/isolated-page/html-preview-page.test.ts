import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  HTML_PREVIEW_CONTENT_SECURITY_POLICY,
  HTML_PREVIEW_MOBILE_MAX_INLINE_HEIGHT,
  HTML_PREVIEW_OPEN_LINK_MESSAGE,
  HTML_PREVIEW_RESIZE_MESSAGE,
  HTML_PREVIEW_RESTORE_LIMITS,
  HTML_PREVIEW_SANDBOX,
  HTML_PREVIEW_THEME_MESSAGE,
} from "@openducktor/contracts";
import { buildHtmlPreviewWrapper, parseHtmlPreviewWebViewMessage } from "./html-preview-page";

const TEST_TOKEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const wrapperInput = {
  html: "<p>Ready</p>",
  scroll: "inline" as const,
  themeCss: ":root{--background:#000;--chat-background:#000}",
  background: "#000",
  foreground: "#fff",
  messageToken: TEST_TOKEN,
};

describe("HTML preview wrapper", () => {
  test("carries the shared policy, sandboxed page frame, and main-frame message relay", () => {
    const wrapper = buildHtmlPreviewWrapper(wrapperInput);

    expect(wrapper).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
    );
    expect(wrapper).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CONTENT_SECURITY_POLICY}">`,
    );
    expect(wrapper).toContain(`frame.sandbox = "${HTML_PREVIEW_SANDBOX}"`);
    expect(wrapper).toContain('frame.scrolling = "no"');
    expect(wrapper).toContain('<base href="about:srcdoc">');
    expect(wrapper).toContain(HTML_PREVIEW_RESIZE_MESSAGE);
    expect(wrapper).toContain(HTML_PREVIEW_OPEN_LINK_MESSAGE);
    expect(wrapper).toContain(HTML_PREVIEW_THEME_MESSAGE);
    expect(wrapper).toContain("window.__odtApplyTheme");
    expect(wrapper).not.toContain("allow-same-origin");
    expect(wrapper).not.toContain('?"auto":"clip"');
  });

  test("keeps frame scrolling enabled in full-screen mode", () => {
    const wrapper = buildHtmlPreviewWrapper({
      ...wrapperInput,
      scroll: "full",
    });

    expect(wrapper).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
    );
    expect(wrapper).not.toContain('frame.scrolling = "no"');
  });

  test("adds the trusted theme and document defaults to the page", () => {
    const wrapper = buildHtmlPreviewWrapper(wrapperInput);

    expect(wrapper).toContain("data-odt-html-preview");
    expect(wrapper).toContain("viewport");
    expect(wrapper).toContain("charset");
    expect(wrapper).toContain("background:#000");
  });

  test("embeds the published HTML as script data that cannot end the wrapper", () => {
    const wrapper = buildHtmlPreviewWrapper({
      ...wrapperInput,
      html: "</script><script>alert(1)</script><p>Ready</p>",
      scroll: "full",
    });

    expect(wrapper).toContain("\\u003c/script\\u003e\\u003cscript\\u003ealert(1)");
    expect(wrapper.match(/<\/script>/g)).toHaveLength(1);
  });
});

const openPreview = () => {
  const wrapper = buildHtmlPreviewWrapper(wrapperInput);
  const page = new DOMParser().parseFromString(wrapper, "text/html");
  const script = page.querySelector("script")?.textContent ?? null;
  if (script === null) throw new Error("The wrapper has no script.");
  document.body.innerHTML = page.body.innerHTML;
  const postedToApp: unknown[] = [];
  // SAFETY: happy-dom's window accepts the ReactNativeWebView bridge property injected by react-native-webview.
  (
    window as typeof window & {
      ReactNativeWebView?: { postMessage: (payload: string) => void };
    }
  ).ReactNativeWebView = {
    postMessage: (payload: string) => {
      postedToApp.push(JSON.parse(payload));
    },
  };
  new Function(script)();
  const frames = (): HTMLIFrameElement[] => [...document.querySelectorAll("iframe")];
  const frame = (): HTMLIFrameElement => {
    const first = frames()[0];
    if (first === undefined) throw new Error("The preview has no page frame.");
    return first;
  };
  const error = document.getElementById("error");
  if (error === null) throw new Error("The wrapper has no error element.");
  return {
    frames,
    frame,
    error,
    postedToApp,
    reportViolation: (documentURI: string): void => {
      const event = new Event("securitypolicyviolation");
      Object.assign(event, { effectiveDirective: "frame-src", documentURI });
      window.dispatchEvent(event);
    },
  };
};

describe("HTML preview wrapper in a document", () => {
  beforeEach(() => {
    if (globalThis.document !== undefined) GlobalRegistrator.unregister();
    GlobalRegistrator.register();
  });

  afterEach(() => {
    setSystemTime();
  });

  test("mounts one sandboxed page and restores it after a later load", () => {
    const preview = openPreview();
    const first = preview.frame();
    expect(preview.frames()).toHaveLength(1);
    expect(first.getAttribute("sandbox")).toBe(HTML_PREVIEW_SANDBOX);
    expect(first.getAttribute("srcdoc")).toContain("<p>Ready</p>");
    expect(preview.error.hidden).toBe(true);

    first.dispatchEvent(new Event("load"));
    expect(preview.frame()).toBe(first);

    first.dispatchEvent(new Event("load"));
    expect(preview.frame()).not.toBe(first);
    expect(preview.frames()).toHaveLength(1);
    expect(preview.error.hidden).toBe(true);
  });

  test("restores the page for the wrapper document policy event only", () => {
    const preview = openPreview();
    const first = preview.frame();

    preview.reportViolation("https://example.com/blocked");
    expect(preview.frame()).toBe(first);

    preview.reportViolation("about");
    expect(preview.frame()).not.toBe(first);
    expect(preview.error.hidden).toBe(true);

    const second = preview.frame();
    preview.reportViolation(document.URL);
    expect(preview.frame()).not.toBe(second);
  });

  test("stops an immediate navigation loop after the window limit and notifies the app", () => {
    const preview = openPreview();
    for (let index = 0; index < HTML_PREVIEW_RESTORE_LIMITS.perWindow; index += 1) {
      preview.reportViolation("about");
    }
    expect(preview.frames()).toHaveLength(1);
    expect(preview.error.hidden).toBe(true);

    preview.reportViolation("about");
    expect(preview.frames()).toHaveLength(0);
    expect(preview.error.hidden).toBe(false);
    expect(preview.error.textContent).toContain("full screen");
    expect(preview.postedToApp).toEqual([
      { token: TEST_TOKEN, type: "displayed" },
      { token: TEST_TOKEN, type: "failed" },
    ]);
  });

  test("accepts only bridge messages carrying the exact per-mount capability token", () => {
    expect(
      parseHtmlPreviewWebViewMessage(
        JSON.stringify({ token: TEST_TOKEN, type: "displayed" }),
        TEST_TOKEN,
      ),
    ).toEqual({ type: "displayed" });
    expect(
      parseHtmlPreviewWebViewMessage(
        JSON.stringify({ token: TEST_TOKEN, type: "resize", height: 420 }),
        TEST_TOKEN,
      ),
    ).toEqual({ type: "resize", height: 420 });
    expect(
      parseHtmlPreviewWebViewMessage(
        JSON.stringify({ token: TEST_TOKEN, type: "open-link", url: "https://example.com" }),
        TEST_TOKEN,
      ),
    ).toEqual({ type: "open-link", url: "https://example.com" });
    expect(
      parseHtmlPreviewWebViewMessage(
        JSON.stringify({ token: TEST_TOKEN, type: "failed" }),
        TEST_TOKEN,
      ),
    ).toEqual({ type: "failed" });

    // Messages posted directly from an untrusted sandboxed iframe lack the private closure token.
    expect(
      parseHtmlPreviewWebViewMessage(
        JSON.stringify({ type: "open-link", url: "https://evil.example" }),
        TEST_TOKEN,
      ),
    ).toBeNull();
    expect(
      parseHtmlPreviewWebViewMessage(
        JSON.stringify({ token: "wrong-token", type: "resize", height: 420 }),
        TEST_TOKEN,
      ),
    ).toBeNull();
    expect(parseHtmlPreviewWebViewMessage("not-json", TEST_TOKEN)).toBeNull();
  });

  test("stops a slow navigation loop after the generation limit", () => {
    const preview = openPreview();
    const start = Date.now();
    const limit = HTML_PREVIEW_RESTORE_LIMITS;
    const stepMs = limit.windowMs + 1;
    for (let index = 0; index < limit.perGeneration; index += 1) {
      setSystemTime(start + index * stepMs);
      preview.reportViolation("about");
    }
    expect(preview.frames()).toHaveLength(1);

    setSystemTime(start + limit.perGeneration * stepMs);
    preview.reportViolation("about");
    expect(preview.frames()).toHaveLength(0);
    expect(preview.error.hidden).toBe(false);
  });

  test("relays validated resize and user-activated https link events only from the mounted frame", () => {
    const preview = openPreview();
    const frameWindow = { postMessage: () => {} };
    Object.defineProperty(preview.frame(), "contentWindow", {
      configurable: true,
      value: frameWindow,
    });

    const dispatchFrom = (
      source: { postMessage: () => void },
      data: { type: string; height?: number; url?: string },
    ) => {
      const event = new Event("message");
      Object.assign(event, { source, data });
      window.dispatchEvent(event);
    };

    const setActivation = (value: { isActive: boolean } | undefined) => {
      Object.defineProperty(navigator, "userActivation", {
        configurable: true,
        value,
      });
    };

    try {
      // Messages from another source, unsafe protocols, or without active user activation are dropped.
      setActivation(undefined);
      dispatchFrom({ postMessage: () => {} }, { type: HTML_PREVIEW_RESIZE_MESSAGE, height: 400 });
      dispatchFrom(frameWindow, {
        type: HTML_PREVIEW_OPEN_LINK_MESSAGE,
        url: "https://example.com/no-activation",
      });
      setActivation({ isActive: false });
      dispatchFrom(frameWindow, {
        type: HTML_PREVIEW_OPEN_LINK_MESSAGE,
        url: "https://example.com/inactive",
      });
      setActivation({ isActive: true });
      dispatchFrom(frameWindow, {
        type: HTML_PREVIEW_OPEN_LINK_MESSAGE,
        url: "javascript:alert(1)",
      });
      expect(preview.postedToApp).toEqual([{ token: TEST_TOKEN, type: "displayed" }]);

      // Valid resize height is clamped to the mobile inline cap; user-activated https links are forwarded with token.
      dispatchFrom(frameWindow, {
        type: HTML_PREVIEW_RESIZE_MESSAGE,
        height: HTML_PREVIEW_MOBILE_MAX_INLINE_HEIGHT + 500,
      });
      dispatchFrom(frameWindow, {
        type: HTML_PREVIEW_OPEN_LINK_MESSAGE,
        url: "https://example.com/report",
      });
      expect(preview.postedToApp).toEqual([
        { token: TEST_TOKEN, type: "displayed" },
        { token: TEST_TOKEN, type: "resize", height: HTML_PREVIEW_MOBILE_MAX_INLINE_HEIGHT },
        { token: TEST_TOKEN, type: "open-link", url: "https://example.com/report" },
      ]);
    } finally {
      setActivation(undefined);
    }
  });
});
