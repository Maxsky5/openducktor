import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  HTML_PREVIEW_MAX_CONTENT_HEIGHT,
  HTML_PREVIEW_MIN_CONTENT_HEIGHT,
  HTML_PREVIEW_SANDBOX,
} from "@openducktor/contracts";
import type { HtmlPreviewSurface } from "@openducktor/frontend-core/sessions/html-preview-document";
import { createHtmlPreviewHeightGovernor } from "@openducktor/frontend-core/sessions/html-preview-height-governor";
import { Maximize2 } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  INITIAL_FIT_CONTENT_HEIGHT,
  readHtmlPreviewPlaceholderHeight,
  readMeasuredHtmlPreviewHeight,
  rememberHtmlPreviewHeight,
} from "./html-preview-cache";

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

export type HtmlPreviewFrameProps = {
  html: string;
  name: string;
  bootstrapUrl: string;
  failureMessage: string;
  fitContent?: boolean;
  contentKey?: string;
  themeCss: string;
  bootstrapSurface: HtmlPreviewSurface;
  onOpenLink?: (url: string) => void;
  onEscape?: () => void;
  onOpenFullScreen?: () => void;
  onViewSource?: () => void;
};

export function HtmlPreviewFrame({
  html,
  name,
  bootstrapUrl,
  failureMessage,
  fitContent = false,
  contentKey,
  themeCss,
  bootstrapSurface,
  onOpenLink,
  onEscape,
  onOpenFullScreen,
  onViewSource,
}: HtmlPreviewFrameProps) {
  const container = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const portRef = useRef<MessagePort | null>(null);
  const generationRef = useRef<string | null>(null);
  const nameRef = useRef(name);
  const themeCssRef = useRef(themeCss);
  const bootstrapSurfaceRef = useRef(bootstrapSurface);
  const onOpenLinkRef = useRef(onOpenLink);
  const onEscapeRef = useRef(onEscape);
  const lastOpenLinkAtRef = useRef(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const contentHeightRef = useRef(INITIAL_FIT_CONTENT_HEIGHT);

  useLayoutEffect(() => {
    const nextHeight = readHtmlPreviewPlaceholderHeight(contentKey);
    contentHeightRef.current = nextHeight;
    if (!fitContent) return;
    const node = container.current;
    if (node) node.style.height = `${nextHeight}px`;
  }, [contentKey, fitContent]);

  useEffect(() => {
    themeCssRef.current = themeCss;
    bootstrapSurfaceRef.current = bootstrapSurface;
    if (frameRef.current) {
      applyOuterFrameSurface(frameRef.current, bootstrapSurface);
    }
    const port = portRef.current;
    const generation = generationRef.current;
    if (!port || generation === null) return;
    port.postMessage({ type: "theme", generation, css: themeCss, surface: bootstrapSurface });
  }, [bootstrapSurface, themeCss]);

  useEffect(() => {
    onOpenLinkRef.current = onOpenLink;
  }, [onOpenLink]);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    const owner = container.current;
    if (!owner) return;
    const frame = document.createElement("iframe");
    frameRef.current = frame;
    setStatus("loading");
    const channel = new MessageChannel();
    const generation = crypto.randomUUID();
    portRef.current = channel.port1;
    generationRef.current = generation;
    const governor = createHtmlPreviewHeightGovernor({
      minHeight: HTML_PREVIEW_MIN_CONTENT_HEIGHT,
      maxHeight: HTML_PREVIEW_MAX_CONTENT_HEIGHT,
    });
    const remembered = readMeasuredHtmlPreviewHeight(contentKey);
    if (remembered !== undefined) {
      governor.reset(remembered);
    }
    let disposed = false;
    let initialized = false;
    let transferred = false;

    const release = () => {
      clearTimeout(timeout);
      frame.removeEventListener("load", initialize);
      frame.removeEventListener("error", fail);
      if (portRef.current === channel.port1) portRef.current = null;
      if (generationRef.current === generation) generationRef.current = null;
      if (disposed) return;
      disposed = true;
      channel.port1.postMessage({ type: "dispose", generation });
      channel.port1.close();
      channel.port2.close();
      frame.remove();
      if (frameRef.current === frame) frameRef.current = null;
    };
    const fail = () => {
      setStatus("error");
      release();
    };
    const timeout = setTimeout(fail, 5_000);
    frame.sandbox.add(...HTML_PREVIEW_SANDBOX.split(" "));
    frame.referrerPolicy = "no-referrer";
    frame.title = `${nameRef.current} HTML preview`;
    frame.className = "block h-full w-full border-0 bg-transparent";
    frame.style.visibility = "hidden";
    const surface = bootstrapSurfaceRef.current;
    applyOuterFrameSurface(frame, surface);

    const initialize = () => {
      if (disposed || initialized || !frame.contentWindow) return;
      initialized = true;
      frame.contentWindow.postMessage({ type: "odt-html-preview-init", generation }, "*", [
        channel.port2,
      ]);
    };
    frame.addEventListener("load", initialize);
    frame.addEventListener("error", fail, { once: true });
    channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
      const message = previewMessageSchema.safeParse(data);
      if (disposed || !message.success || message.data.generation !== generation) return;
      if (message.data.type === "ready" && !transferred) {
        transferred = true;
        channel.port1.postMessage({ type: "render", generation, html });
      } else if (message.data.type === "displayed" && transferred) {
        clearTimeout(timeout);
        frame.style.visibility = "visible";
        setStatus("ready");
        channel.port1.postMessage({
          type: "theme",
          generation,
          css: themeCssRef.current,
          surface: bootstrapSurfaceRef.current,
        });
      } else if (message.data.type === "resize") {
        const height = governor.accept(message.data.height);
        if (height === null) return;
        contentHeightRef.current = height;
        if (fitContent) {
          const node = container.current;
          if (node) node.style.height = `${height}px`;
        }
        if (contentKey) rememberHtmlPreviewHeight(contentKey, height);
      } else if (message.data.type === "open-link") {
        if (document.activeElement !== frame || !hasActiveUserActivation()) return;
        const now = Date.now();
        if (now - lastOpenLinkAtRef.current < OPEN_LINK_COOLDOWN_MS) return;
        const href = isSafeExternalHttpUrl(message.data.url);
        if (!href) return;
        lastOpenLinkAtRef.current = now;
        onOpenLinkRef.current?.(href);
      } else if (message.data.type === "escape") {
        if (document.activeElement !== frame) return;
        onEscapeRef.current?.();
      } else if (message.data.type === "failed") {
        fail();
      }
    };
    channel.port1.onmessageerror = fail;
    frame.src = bootstrapSource(bootstrapUrl, surface);
    owner.append(frame);
    return release;
  }, [bootstrapUrl, contentKey, fitContent, html]);

  useEffect(() => {
    nameRef.current = name;
    if (frameRef.current) frameRef.current.title = `${name} HTML preview`;
  }, [name]);

  const loadingNotice =
    status === "loading" ? (
      <p
        role="status"
        className={
          fitContent
            ? "pointer-events-none absolute inset-x-0 top-0 flex h-24 items-center justify-center text-sm text-muted-foreground"
            : "min-h-0 overflow-auto p-4 text-sm text-muted-foreground"
        }
      >
        Loading preview…
      </p>
    ) : null;

  const errorNotice =
    status === "error" ? (
      <div className={fitContent ? "space-y-2 py-4" : "min-h-0 space-y-2 overflow-auto p-4"}>
        <p role="alert" className="text-sm text-destructive">
          {failureMessage}
        </p>
        {onViewSource ? (
          <Button type="button" variant="outline" size="sm" onClick={onViewSource}>
            View source
          </Button>
        ) : null}
      </div>
    ) : null;

  const frameHost = (
    <div
      ref={container}
      className={fitContent ? "w-full overflow-hidden" : "min-h-0 min-w-0 flex-1 overflow-hidden"}
      hidden={status === "error"}
    />
  );

  if (!fitContent) {
    return (
      <>
        {loadingNotice}
        {errorNotice}
        {frameHost}
      </>
    );
  }

  return (
    <div className="relative w-full">
      {frameHost}
      {status !== "error" && onOpenFullScreen ? (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-60 transition-opacity duration-150 focus-within:opacity-100 hover:opacity-100 pointer-coarse:opacity-100">
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="size-7 border-border/60 bg-background/80 px-0 text-foreground shadow-sm backdrop-blur-sm hover:bg-background"
            aria-label="Open full screen"
            title="Open full screen"
            onClick={onOpenFullScreen}
          >
            <Maximize2 aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      ) : null}
      {loadingNotice}
      {errorNotice}
    </div>
  );
}
