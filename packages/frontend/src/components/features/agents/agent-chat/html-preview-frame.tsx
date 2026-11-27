import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HtmlPreviewSurface } from "@openducktor/frontend-core/sessions/html-preview-document";
import { Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readHtmlPreviewPlaceholderHeight } from "./html-preview-cache";
import { type HtmlPreviewFrameSession, mountHtmlPreviewFrame } from "./html-preview-frame-session";

export type HtmlPreviewFrameProps = {
  html: string | null;
  name: string;
  bootstrapUrl: string;
  failureMessage: string;
  fitContent?: boolean;
  contentKey?: string;
  themeCss: string;
  bootstrapSurface: HtmlPreviewSurface;
  onOpenLink?: ((url: string) => void) | undefined;
  onEscape?: (() => void) | undefined;
  onOpenFullScreen?: (() => void) | undefined;
  onViewSource?: (() => void) | undefined;
};

type FrameStatus = "loading" | "ready" | "error";

const useDocumentRevision = (contentKey: string | undefined, html: string | null): number => {
  const [state, setState] = useState(() => ({ contentKey, lastHtml: html, revision: 0 }));
  if (state.contentKey !== contentKey) {
    setState({ contentKey, lastHtml: html, revision: state.revision });
    return state.revision;
  }
  if (html !== null && state.lastHtml !== html) {
    const nextRevision = state.lastHtml === null ? state.revision : state.revision + 1;
    setState({ contentKey, lastHtml: html, revision: nextRevision });
    return nextRevision;
  }
  return state.revision;
};

function HtmlPreviewStatusNotice({
  status,
  fitContent,
  failureMessage,
  onViewSource,
}: {
  status: FrameStatus;
  fitContent: boolean;
  failureMessage: string;
  onViewSource: (() => void) | undefined;
}): ReactElement | null {
  if (status === "loading") {
    return (
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
    );
  }
  if (status === "error") {
    return (
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
    );
  }
  return null;
}

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
  const sessionRef = useRef<HtmlPreviewFrameSession | null>(null);
  const latestRef = useRef({ html, name, themeCss, bootstrapSurface, onOpenLink, onEscape });
  useLayoutEffect(() => {
    latestRef.current = { html, name, themeCss, bootstrapSurface, onOpenLink, onEscape };
  }, [bootstrapSurface, html, name, onEscape, onOpenLink, themeCss]);
  const [status, setStatus] = useState<FrameStatus>("loading");
  // Pre-warming the bootstrap iframe while `html` is null keeps the same iframe when the first
  // HTML arrives, and increments `revision` only when a rendered document is replaced in place.
  const revision = useDocumentRevision(contentKey, html);

  useLayoutEffect(() => {
    if (!fitContent) return;
    const node = container.current;
    if (node) node.style.height = `${readHtmlPreviewPlaceholderHeight(contentKey)}px`;
  }, [contentKey, fitContent]);

  useEffect(() => {
    const owner = container.current;
    if (!owner) return;
    const initial = latestRef.current;
    const session = mountHtmlPreviewFrame({
      owner,
      bootstrapUrl,
      contentKey,
      fitContent,
      initialHtml: initial.html,
      initialName: initial.name,
      initialThemeCss: initial.themeCss,
      initialSurface: initial.bootstrapSurface,
      onStatusChange: setStatus,
      onOpenLink: (url) => latestRef.current.onOpenLink?.(url),
      onEscape: () => latestRef.current.onEscape?.(),
    });
    sessionRef.current = session;
    return () => {
      if (sessionRef.current === session) sessionRef.current = null;
      session.dispose();
    };
  }, [bootstrapUrl, contentKey, fitContent, revision]);

  useEffect(() => {
    sessionRef.current?.updateHtml(html);
  }, [html]);

  useEffect(() => {
    sessionRef.current?.updateTheme(themeCss, bootstrapSurface);
  }, [bootstrapSurface, themeCss]);

  useEffect(() => {
    sessionRef.current?.updateTitle(name);
  }, [name]);

  const statusNotice = (
    <HtmlPreviewStatusNotice
      status={status}
      fitContent={fitContent}
      failureMessage={failureMessage}
      onViewSource={onViewSource}
    />
  );

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
        {statusNotice}
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
      {statusNotice}
    </div>
  );
}
