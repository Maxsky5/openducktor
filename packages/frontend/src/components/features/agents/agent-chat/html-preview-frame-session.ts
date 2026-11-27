import {
  HTML_PREVIEW_MAX_CONTENT_HEIGHT,
  HTML_PREVIEW_MIN_CONTENT_HEIGHT,
  HTML_PREVIEW_SANDBOX,
} from "@openducktor/contracts";
import type { HtmlPreviewSurface } from "@openducktor/frontend-core/sessions/html-preview-document";
import { createHtmlPreviewHeightGovernor } from "@openducktor/frontend-core/sessions/html-preview-height-governor";
import { z } from "zod";
import { readMeasuredHtmlPreviewHeight, rememberHtmlPreviewHeight } from "./html-preview-cache";

const previewMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ generation: z.string(), type: z.literal("ready") }),
  z.strictObject({ generation: z.string(), type: z.literal("displayed") }),
  z.strictObject({ generation: z.string(), type: z.literal("failed") }),
  z.strictObject({
    generation: z.string(),
    type: z.literal("resize"),
    height: z.number().finite().positive(),
  }),
  z.strictObject({
    generation: z.string(),
    type: z.literal("open-link"),
    url: z.string().min(1).max(4096),
  }),
  z.strictObject({ generation: z.string(), type: z.literal("escape") }),
]);

const OPEN_LINK_COOLDOWN_MS = 1_000;
const FRAME_START_TIMEOUT_MS = 5_000;

const bootstrapSource = (base: string, surface: HtmlPreviewSurface | undefined): string => {
  if (!surface) return base;
  const url = new URL(base);
  url.hash = `odt-surface=${encodeURIComponent(JSON.stringify(surface))}`;
  return url.href;
};

const applyOuterFrameSurface = (
  frame: HTMLIFrameElement,
  surface: HtmlPreviewSurface | undefined,
): void => {
  if (!surface) return;
  frame.style.colorScheme = surface.appearance;
  if (surface.background.length > 0) {
    frame.style.background = surface.background;
  }
};

const sameSurface = (left: HtmlPreviewSurface, right: HtmlPreviewSurface): boolean =>
  left.appearance === right.appearance && left.background === right.background;

const hasActiveUserActivation = (): boolean => {
  // SAFETY: UserActivation is a standard Chromium/Web API property absent from older lib.dom types.
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
    .userActivation;
  // Environments without UserActivation API (for example unit test DOMs) fall back to activeElement.
  return activation ? activation.isActive : true;
};

const isSafeExternalHttpUrl = (rawUrl: string): string | null => {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
};

export type HtmlPreviewFrameSession = {
  updateHtml: (nextHtml: string | null) => void;
  updateTheme: (css: string, surface: HtmlPreviewSurface) => void;
  updateTitle: (name: string) => void;
  dispose: () => void;
};

type MountHtmlPreviewFrameOptions = {
  owner: HTMLDivElement;
  bootstrapUrl: string;
  contentKey: string | undefined;
  fitContent: boolean;
  initialHtml: string | null;
  initialName: string;
  initialThemeCss: string;
  initialSurface: HtmlPreviewSurface;
  onStatusChange: (status: "loading" | "ready" | "error") => void;
  onOpenLink: (url: string) => void;
  onEscape: () => void;
};

/**
 * Mounts one isolated HTML preview bootstrap iframe and owns its MessageChannel lifecycle.
 * Sends `html` in the initial handshake when already available, or pre-warms the bootstrap frame
 * while `html` is null and renders immediately once `updateHtml` delivers it.
 */
export const mountHtmlPreviewFrame = ({
  owner,
  bootstrapUrl,
  contentKey,
  fitContent,
  initialHtml,
  initialName,
  initialThemeCss,
  initialSurface,
  onStatusChange,
  onOpenLink,
  onEscape,
}: MountHtmlPreviewFrameOptions): HtmlPreviewFrameSession => {
  const frame = document.createElement("iframe");
  const channel = new MessageChannel();
  const generation = crypto.randomUUID();
  const applyMeasuredHeight = (height: number): void => {
    if (disposed) return;
    if (fitContent) {
      owner.style.height = `${height}px`;
    }
    if (contentKey) rememberHtmlPreviewHeight(contentKey, height);
  };

  const governor = createHtmlPreviewHeightGovernor({
    minHeight: HTML_PREVIEW_MIN_CONTENT_HEIGHT,
    maxHeight: HTML_PREVIEW_MAX_CONTENT_HEIGHT,
    onDeferredHeight: applyMeasuredHeight,
  });
  const remembered = readMeasuredHtmlPreviewHeight(contentKey);
  if (remembered !== undefined) {
    governor.reset(remembered);
  }

  let currentHtml = initialHtml;
  let currentThemeCss = initialThemeCss;
  let currentSurface = initialSurface;
  let disposed = false;
  let initialized = false;
  let bootstrapReady = false;
  let transferred = false;
  let displayed = false;
  let lastOpenLinkAt = 0;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const clearPendingTimeout = (): void => {
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  const armTimeout = (): void => {
    clearPendingTimeout();
    timeout = setTimeout(fail, FRAME_START_TIMEOUT_MS);
  };

  const dispose = (): void => {
    clearPendingTimeout();
    governor.dispose();
    frame.removeEventListener("load", initialize);
    frame.removeEventListener("error", fail);
    if (disposed) return;
    disposed = true;
    channel.port1.postMessage({ type: "dispose", generation });
    channel.port1.close();
    channel.port2.close();
    frame.remove();
  };

  const fail = (): void => {
    onStatusChange("error");
    dispose();
  };

  const sendRender = (nextHtml: string): void => {
    transferred = true;
    armTimeout();
    channel.port1.postMessage({ type: "render", generation, html: nextHtml });
  };

  const initialize = (): void => {
    if (disposed || initialized || !frame.contentWindow) return;
    initialized = true;
    if (currentHtml !== null) {
      transferred = true;
      frame.contentWindow.postMessage(
        { type: "odt-html-preview-init", generation, html: currentHtml },
        "*",
        [channel.port2],
      );
      return;
    }
    frame.contentWindow.postMessage({ type: "odt-html-preview-init", generation }, "*", [
      channel.port2,
    ]);
  };

  onStatusChange("loading");
  armTimeout();
  frame.sandbox.add(...HTML_PREVIEW_SANDBOX.split(" "));
  frame.referrerPolicy = "no-referrer";
  frame.title = `${initialName} HTML preview`;
  frame.className = "block h-full w-full border-0 bg-transparent";
  frame.style.visibility = "hidden";
  applyOuterFrameSurface(frame, initialSurface);

  frame.addEventListener("load", initialize);
  frame.addEventListener("error", fail, { once: true });
  channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
    const message = previewMessageSchema.safeParse(data);
    if (disposed || !message.success || message.data.generation !== generation) return;
    if (message.data.type === "ready" && !transferred) {
      bootstrapReady = true;
      if (currentHtml !== null) {
        sendRender(currentHtml);
      } else {
        clearPendingTimeout();
      }
      return;
    }
    if (message.data.type === "displayed" && transferred) {
      clearPendingTimeout();
      displayed = true;
      frame.style.visibility = "visible";
      onStatusChange("ready");
      if (currentThemeCss !== initialThemeCss || !sameSurface(currentSurface, initialSurface)) {
        channel.port1.postMessage({
          type: "theme",
          generation,
          css: currentThemeCss,
          surface: currentSurface,
        });
      }
      return;
    }
    if (message.data.type === "resize") {
      const height = governor.accept(message.data.height);
      if (height === null) return;
      applyMeasuredHeight(height);
      return;
    }
    if (message.data.type === "open-link") {
      if (document.activeElement !== frame || !hasActiveUserActivation()) return;
      const now = Date.now();
      if (now - lastOpenLinkAt < OPEN_LINK_COOLDOWN_MS) return;
      const href = isSafeExternalHttpUrl(message.data.url);
      if (!href) return;
      lastOpenLinkAt = now;
      onOpenLink(href);
      return;
    }
    if (message.data.type === "escape") {
      if (document.activeElement !== frame) return;
      onEscape();
      return;
    }
    if (message.data.type === "failed") {
      fail();
    }
  };
  channel.port1.onmessageerror = fail;
  frame.src = bootstrapSource(bootstrapUrl, initialSurface);
  owner.append(frame);

  return {
    updateHtml: (nextHtml) => {
      currentHtml = nextHtml;
      if (disposed || nextHtml === null || !bootstrapReady || transferred) return;
      sendRender(nextHtml);
    },
    updateTheme: (css, surface) => {
      currentThemeCss = css;
      currentSurface = surface;
      if (disposed) return;
      applyOuterFrameSurface(frame, surface);
      if (displayed) {
        channel.port1.postMessage({ type: "theme", generation, css, surface });
      }
    },
    updateTitle: (name) => {
      if (!disposed) frame.title = `${name} HTML preview`;
    },
    dispose,
  };
};
