import { BROWSER_FRAME_COMMAND_FIELD, BROWSER_FRAME_MESSAGE_MARK } from "@openducktor/contracts";

/** The path of the frame script in each preview origin. */
export const BROWSER_PREVIEW_SCRIPT_PATH = "/__openducktor/frame.js";
/** A redirect to a site outside the host lands here, and the tab then loads that site. */
export const BROWSER_PREVIEW_LEAVE_PATH = "/__openducktor/leave";

/** A favicon above this size does not reach the tab, so a tab summary stays small. */
const FAVICON_MAX_BYTES = 48_000;

/**
 * The script that the preview proxy adds to each page. It runs only in the frame of a browser tab,
 * not in the frames of the page itself. It sends the page state to the app, and it runs the back,
 * forward, reload, and stop commands of the app. A navigation to the dev server origin stays in
 * the preview. A navigation to a site outside the host goes to the app, which loads that site in
 * the same frame.
 */
export const browserPreviewFrameScript = (input: {
  targetOrigin: string;
  appOrigins: readonly string[];
}): string => `(() => {
  "use strict";
  if (window.parent === window || window.parent !== window.top) return;
  const TARGET = ${JSON.stringify(input.targetOrigin)};
  const APP_ORIGINS = ${JSON.stringify(input.appOrigins)};
  const MARK = ${JSON.stringify(BROWSER_FRAME_MESSAGE_MARK)};
  const COMMAND = ${JSON.stringify(BROWSER_FRAME_COMMAND_FIELD)};
  const ancestor = location.ancestorOrigins ? location.ancestorOrigins[0] : undefined;
  const appOrigin = APP_ORIGINS.includes(ancestor) ? ancestor : APP_ORIGINS[0];
  const nav = window.navigation;
  const post = (message) => window.parent.postMessage({ [MARK]: 1, ...message }, appOrigin);
  const LEAVE_PATH = ${JSON.stringify(BROWSER_PREVIEW_LEAVE_PATH)};
  // The leave page shows the address of the site that the page wanted to open.
  const toTarget = (url) =>
    url.origin !== location.origin
      ? url.href
      : url.pathname === LEAVE_PATH
        ? url.searchParams.get("url") || TARGET + "/"
        : TARGET + url.pathname + url.search + url.hash;
  const toPreview = (url) => location.origin + url.pathname + url.search + url.hash;
  const isWeb = (url) => url.protocol === "http:" || url.protocol === "https:";

  let favicon = null;
  let faviconHref = null;
  let last = "";
  const report = () => {
    const state = {
      type: "state",
      url: toTarget(new URL(location.href)),
      title: document.title || null,
      favicon,
      canGoBack: nav ? nav.canGoBack : false,
      canGoForward: nav ? nav.canGoForward : false,
      error: typeof window.__openducktorFrameError === "string" ? window.__openducktorFrameError : null,
    };
    const text = JSON.stringify(state);
    if (text === last) return;
    last = text;
    post(state);
  };
  const readFavicon = () => {
    const link = document.querySelector('link[rel~="icon"]');
    const href = link && link.href ? link.href : new URL("/favicon.ico", location.href).href;
    if (href === faviconHref) return;
    faviconHref = href;
    if (href.startsWith("data:")) {
      favicon = href.length <= 65536 ? href : null;
      report();
      return;
    }
    if (new URL(href).origin !== location.origin) return;
    fetch(href)
      .then((response) =>
        response.ok && /^image\\//.test(response.headers.get("content-type") || "") ? response.blob() : null,
      )
      .then((blob) =>
        blob && blob.size <= ${FAVICON_MAX_BYTES}
          ? new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => resolve(null);
              reader.readAsDataURL(blob);
            })
          : null,
      )
      .then((data) => {
        if (faviconHref !== href) return;
        favicon = typeof data === "string" ? data : null;
        report();
      }, () => {});
  };
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      report();
      readFavicon();
    }, 0);
  };
  const leave = (url) => post({ type: "leave", url: url.href });

  // A form that sends to the dev server sends to the preview, so it keeps its method and fields.
  addEventListener("submit", (event) => {
    const form = event.target;
    if (event.defaultPrevented || !(form instanceof HTMLFormElement)) return;
    const submitter =
      event.submitter && event.submitter.hasAttribute("formaction") ? event.submitter : null;
    const url = new URL(submitter ? submitter.formAction : form.action);
    if (url.origin !== TARGET) return;
    if (submitter) submitter.formAction = toPreview(url);
    else form.action = toPreview(url);
  });

  if (nav) {
    nav.addEventListener("currententrychange", schedule);
    nav.addEventListener("navigate", (event) => {
      if (event.hashChange || event.downloadRequest !== null) return;
      const url = new URL(event.destination.url);
      if (url.origin === location.origin) {
        if (!event.destination.sameDocument) post({ type: "loading", url: toTarget(url) });
        return;
      }
      if (!event.cancelable || !isWeb(url)) return;
      event.preventDefault();
      if (url.origin === TARGET) location.assign(toPreview(url));
      else leave(url);
    });
  } else {
    document.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link || (link.target && link.target !== "_self")) return;
      const url = new URL(link.href);
      if (url.origin === location.origin || !isWeb(url)) return;
      event.preventDefault();
      if (url.origin === TARGET) location.assign(toPreview(url));
      else leave(url);
    }, true);
    addEventListener("popstate", schedule);
    addEventListener("hashchange", schedule);
  }

  addEventListener("message", (event) => {
    if (event.source !== window.parent || !APP_ORIGINS.includes(event.origin)) return;
    const command = event.data ? event.data[COMMAND] : undefined;
    if (command === "back" && nav && nav.canGoBack) history.back();
    else if (command === "forward" && nav && nav.canGoForward) history.forward();
    else if (command === "reload") location.reload();
    else if (command === "stop") window.stop();
  });
  addEventListener("keydown", (event) => {
    if (event.key !== "F6" || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    post({ type: "focus_address_bar" });
  }, true);
  if (location.pathname === LEAVE_PATH) {
    const outside = new URL(location.href).searchParams.get("url");
    if (outside && URL.canParse(outside)) leave(new URL(outside));
  }
  addEventListener("pageshow", () => {
    last = "";
    schedule();
  });
  addEventListener("load", schedule);
  if (document.readyState === "loading") {
    addEventListener("DOMContentLoaded", schedule, { once: true });
  }
  new MutationObserver(schedule).observe(document.head || document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  schedule();
})();
`;
