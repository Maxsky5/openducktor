import type { ArtifactPreviewEnvironment } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useSessionHtmlPreview } from "@openducktor/frontend-core/queries/session-html-previews";
import { buildHtmlPreviewDocument } from "@openducktor/frontend-core/sessions/html-preview-document";
import type { HtmlPreviewToolCall } from "@openducktor/frontend-core/sessions/messages/html-preview-tool";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { returnFocusOnClose } from "@/components/ui/open-dialogs";
import { useOpenExternalUrl } from "@/lib/open-external-url";
import { useShellPlatform } from "@/lib/shell-platform";
import {
  loadCachedHtmlPreviewEnvironment,
  readCachedHtmlPreviewEnvironment,
  readHtmlPreviewPlaceholderHeight,
} from "./html-preview-cache";
import { HtmlPreviewFrame } from "./html-preview-frame";
import { useHtmlPreviewTheme } from "./html-preview-theme";

type PreviewMode = "preview" | "source";

type PreviewEnvironmentState =
  | { status: "loading" }
  | { status: "ready"; environment: ArtifactPreviewEnvironment }
  | { status: "error"; message: string };

const PREVIEW_VIEWPORT_ROOT_MARGIN = "1800px 0px";

/** A published HTML preview in the transcript, at the position of its call. */
export function AgentChatHtmlPreview({ preview }: { preview: HtmlPreviewToolCall }): ReactElement {
  const { getArtifactPreviewEnvironment } = useShellPlatform();
  const hostRef = useRef<HTMLDivElement>(null);
  const [hasEnteredViewport, setHasEnteredViewport] = useState(false);
  const [environment, setEnvironment] = useState<PreviewEnvironmentState>(() => {
    const cached = readCachedHtmlPreviewEnvironment(getArtifactPreviewEnvironment);
    return cached ? { status: "ready", environment: cached } : { status: "loading" };
  });

  useEffect(() => {
    if (hasEnteredViewport) return;
    const element = hostRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setHasEnteredViewport(true);
        observer.disconnect();
      },
      {
        root: element.closest(".agent-chat-scroll-region"),
        rootMargin: PREVIEW_VIEWPORT_ROOT_MARGIN,
      },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasEnteredViewport]);

  // Resolve the shared preview environment in parallel with viewport detection and host HTML reads.
  useEffect(() => {
    const cached = readCachedHtmlPreviewEnvironment(getArtifactPreviewEnvironment);
    if (cached) {
      setEnvironment({ status: "ready", environment: cached });
      return;
    }
    let current = true;
    void loadCachedHtmlPreviewEnvironment(getArtifactPreviewEnvironment).then(
      (value) => {
        if (current) setEnvironment({ status: "ready", environment: value });
      },
      (cause: unknown) => {
        if (current)
          setEnvironment({
            status: "error",
            message:
              cause instanceof Error
                ? cause.message
                : "Cannot start the isolated HTML viewer. Reopen the message to try again.",
          });
      },
    );
    return () => {
      current = false;
    };
  }, [getArtifactPreviewEnvironment]);

  const { html, loading, error, retry } = useSessionHtmlPreview(preview.previewId, undefined, {
    enabled: hasEnteredViewport,
  });

  let body: ReactElement;
  if (!hasEnteredViewport) {
    body = (
      <section aria-label={`${preview.title} HTML preview`} className="relative min-w-0">
        <HtmlPreviewPlaceholder contentKey={preview.previewId} />
      </section>
    );
  } else if (html !== null || loading) {
    body = (
      <HtmlPreviewContent
        title={preview.title}
        html={html}
        contentKey={preview.previewId}
        environment={environment}
      />
    );
  } else {
    body = (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          Cannot read the published HTML of {preview.title}:{" "}
          {error ?? "the host did not return the stored preview."}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div ref={hostRef} className="my-1 min-w-0">
      {body}
    </div>
  );
}

function HtmlPreviewContent({
  title,
  html,
  contentKey,
  environment,
}: {
  title: string;
  html: string | null;
  contentKey: string;
  environment: PreviewEnvironmentState;
}): ReactElement {
  const openExternalUrl = useOpenExternalUrl();
  const [mode, setMode] = useState<PreviewMode | null>(null);
  const [fullscreenHtml, setFullscreenHtml] = useState<string | null>(null);
  const { css: themeCss, surface } = useHtmlPreviewTheme();
  const [initialThemeSnapshot, setInitialThemeSnapshot] = useState(() => ({
    html,
    css: themeCss,
  }));
  const inlineThemeCss = initialThemeSnapshot.html === html ? initialThemeSnapshot.css : themeCss;
  if (initialThemeSnapshot.html !== html) {
    setInitialThemeSnapshot({ html, css: themeCss });
  }

  const inlinePageHtml = useMemo(
    () =>
      html === null
        ? null
        : buildHtmlPreviewDocument(html, inlineThemeCss, { containScroll: true }),
    [html, inlineThemeCss],
  );

  const openPreview = () => {
    if (html === null) return;
    setFullscreenHtml(
      (current) => current ?? buildHtmlPreviewDocument(html, themeCss, { forwardEscape: true }),
    );
    setMode("preview");
  };

  const openSource = useCallback(() => {
    setMode("source");
  }, []);

  const closeDialog = useCallback(() => {
    setMode(null);
    setFullscreenHtml(null);
  }, []);

  const handleOpenLink = useCallback(
    (url: string) => {
      void openExternalUrl(url).catch((cause: unknown) => {
        toast.error("Failed to open link", { description: errorMessage(cause) });
      });
    },
    [openExternalUrl],
  );

  return (
    <>
      <section aria-label={`${title} HTML preview`} className="relative min-w-0">
        {environment.status === "loading" ? (
          <HtmlPreviewPlaceholder contentKey={contentKey} loading />
        ) : environment.status === "error" ? (
          <div className="py-4">
            <p role="alert" className="text-sm text-destructive">
              Cannot preview {title}: {environment.message}
            </p>
            {html !== null ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={openSource}
              >
                View source
              </Button>
            ) : null}
          </div>
        ) : (
          <HtmlPreviewFrame
            html={inlinePageHtml}
            name={title}
            contentKey={contentKey}
            bootstrapUrl={environment.environment.htmlPreviewBootstrapUrl}
            failureMessage={`Cannot preview ${title}: the isolated preview did not start or stopped. View the source below, or reopen the message to try again.`}
            fitContent
            themeCss={themeCss}
            bootstrapSurface={surface}
            onOpenLink={handleOpenLink}
            onOpenFullScreen={html !== null ? openPreview : undefined}
            onViewSource={html !== null ? openSource : undefined}
          />
        )}
      </section>
      <HtmlPreviewDialog
        title={title}
        html={html}
        mode={mode}
        fullscreenHtml={fullscreenHtml}
        environment={environment}
        themeCss={themeCss}
        surface={surface}
        onOpenPreview={openPreview}
        onOpenSource={openSource}
        onClose={closeDialog}
        onOpenLink={handleOpenLink}
      />
    </>
  );
}

function HtmlPreviewDialog({
  title,
  html,
  mode,
  fullscreenHtml,
  environment,
  themeCss,
  surface,
  onOpenPreview,
  onOpenSource,
  onClose,
  onOpenLink,
}: {
  title: string;
  html: string | null;
  mode: PreviewMode | null;
  fullscreenHtml: string | null;
  environment: PreviewEnvironmentState;
  themeCss: string;
  surface: { appearance: "light" | "dark"; background: string };
  onOpenPreview: () => void;
  onOpenSource: () => void;
  onClose: () => void;
  onOpenLink: (url: string) => void;
}): ReactElement {
  const openerRef = useRef<HTMLElement | null>(null);
  return (
    <Dialog
      open={mode !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="h-[calc(100dvh-4rem)] max-w-6xl overflow-hidden p-0"
        onOpenAutoFocus={() => {
          openerRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={returnFocusOnClose(() => openerRef.current)}
      >
        <DialogHeader className="border-b border-border px-4 py-3 pr-12">
          <div className="flex min-w-0 items-center gap-3">
            <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium">
              {title}
            </DialogTitle>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="toggle"
                size="xs"
                aria-pressed={mode === "preview"}
                onClick={() => {
                  if (mode !== "preview") onOpenPreview();
                }}
              >
                Preview
              </Button>
              <Button
                type="button"
                variant="toggle"
                size="xs"
                aria-pressed={mode === "source"}
                onClick={onOpenSource}
              >
                Source
              </Button>
            </div>
          </div>
          <DialogDescription className="sr-only">
            The published HTML preview and its original source.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {mode === "preview" && environment.status === "loading" ? (
            <p role="status" className="p-4 text-sm text-muted-foreground">
              Loading preview…
            </p>
          ) : null}
          {mode === "preview" && environment.status === "error" ? (
            <p role="alert" className="p-4 text-sm text-destructive">
              Cannot preview {title}: {environment.message}
            </p>
          ) : null}
          {environment.status === "ready" && fullscreenHtml !== null ? (
            <div className={mode === "preview" ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}>
              <HtmlPreviewFrame
                html={fullscreenHtml}
                name={title}
                bootstrapUrl={environment.environment.htmlPreviewBootstrapUrl}
                failureMessage={`Cannot preview ${title}: the isolated preview did not start or stopped. Switch to Source to read the HTML, or close the view and try again.`}
                themeCss={themeCss}
                bootstrapSurface={surface}
                onOpenLink={onOpenLink}
                onViewSource={onOpenSource}
                onEscape={onClose}
              />
            </div>
          ) : null}
          {mode === "source" && html !== null ? (
            <HtmlPreviewSource html={html} title={title} />
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function HtmlPreviewPlaceholder({
  contentKey,
  loading = false,
}: {
  contentKey: string;
  loading?: boolean;
}): ReactElement {
  return (
    <div
      className="relative w-full"
      style={{ height: readHtmlPreviewPlaceholderHeight(contentKey) }}
    >
      {loading ? (
        <p
          role="status"
          className="pointer-events-none absolute inset-x-0 top-0 flex h-24 items-center justify-center text-sm text-muted-foreground"
        >
          Loading preview…
        </p>
      ) : null}
    </div>
  );
}

function HtmlPreviewSource({ html, title }: { html: string; title: string }): ReactElement {
  return (
    <pre
      aria-label={`${title} HTML source`}
      className="h-full min-h-0 overflow-auto whitespace-pre-wrap break-words bg-muted/40 p-4 font-mono text-xs text-foreground"
    >
      {html}
    </pre>
  );
}
