import { AlertCircle, Expand } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Dialog, DialogTrigger } from "./dialog";
import { MarkdownMermaidDialog } from "./markdown-mermaid-dialog";
import { drawMermaidSvg, peekMermaidSvg } from "./markdown-mermaid-svg-cache";
import { useMermaidSvgCache } from "./markdown-mermaid-svg-cache-context";
import { MarkdownOpenFenceContext } from "./markdown-open-fence";
import {
  getMermaidErrorMessage,
  type MermaidPreview,
  type MermaidPreviews,
} from "./markdown-mermaid-state";

const MermaidPreviewContext = createContext<MermaidPreviews | null>(null);

/** The last preview of the diagram, and the source that it shows. */
type DrawnDiagram = { source: string; preview: MermaidPreview };

const createRenderId = (reactId: string): string =>
  `odt-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}-${crypto.randomUUID()}`;

export function MermaidPreviewProvider({
  previews,
  children,
}: {
  previews: MermaidPreviews;
  children: ReactNode;
}) {
  return (
    <MermaidPreviewContext.Provider value={previews}>{children}</MermaidPreviewContext.Provider>
  );
}

export function MarkdownMermaid({
  source,
  renderDelayMs = 0,
  expandable = false,
}: {
  source: string;
  renderDelayMs?: number;
  expandable?: boolean;
}) {
  const reactId = useId();
  const preparedPreview = useContext(MermaidPreviewContext)?.get(source);
  // A source in a fence that is not closed is incomplete, so a render now would show a partial
  // diagram or an error.
  const sourceOpen = useContext(MarkdownOpenFenceContext) === source;
  const svgCache = useMermaidSvgCache();
  const [drawn, setDrawn] = useState<DrawnDiagram | null>(() => {
    const svg = peekMermaidSvg(svgCache, source, createRenderId(reactId));
    return svg === null ? null : { source, preview: { status: "ready", svg } };
  });
  const [openSvg, setOpenSvg] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const drawnSource = drawn?.source;

  useLayoutEffect(() => {
    if (preparedPreview || sourceOpen || drawnSource === source) {
      return;
    }
    const cachedSvg = peekMermaidSvg(svgCache, source, createRenderId(reactId));
    if (cachedSvg !== null) {
      setDrawn({ source, preview: { status: "ready", svg: cachedSvg } });
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) return;
    let active = true;
    let scheduled = false;
    let renderFrame: number | null = null;
    let renderTimeout: ReturnType<typeof setTimeout> | null = null;
    const renderDiagram = async (): Promise<void> => {
      let preview: MermaidPreview;
      try {
        const svg = await drawMermaidSvg(svgCache, source, createRenderId(reactId));
        preview = { status: "ready", svg };
      } catch (cause) {
        preview = { status: "error", message: getMermaidErrorMessage(cause) };
      }
      if (active) {
        setDrawn({ source, preview });
      }
    };
    // Mermaid layout blocks the main thread. Draw only near the viewport, after it can paint.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!active || scheduled || !entry?.isIntersecting) return;
        scheduled = true;
        observer.disconnect();
        if (renderDelayMs > 0) {
          renderTimeout = setTimeout(() => void renderDiagram(), renderDelayMs);
          return;
        }
        renderFrame = requestAnimationFrame(() => {
          renderFrame = requestAnimationFrame(() => void renderDiagram());
        });
      },
      { rootMargin: "200px" },
    );
    observer.observe(viewport);
    return () => {
      active = false;
      observer.disconnect();
      if (renderFrame !== null) cancelAnimationFrame(renderFrame);
      if (renderTimeout !== null) clearTimeout(renderTimeout);
    };
  }, [drawnSource, preparedPreview, reactId, renderDelayMs, source, sourceOpen, svgCache]);

  const preview = preparedPreview ?? drawn?.preview ?? null;

  const diagram =
    preview?.status === "ready" ? (
      <span
        className="flex w-full justify-center [&_svg]:h-auto [&_svg]:max-w-full"
        // oxlint-disable-next-line react/no-danger -- Mermaid strict-mode output passes through DOMPurify
        dangerouslySetInnerHTML={{ __html: preview.svg }}
      />
    ) : null;

  return (
    <Dialog open={openSvg !== null} onOpenChange={(open) => !open && setOpenSvg(null)}>
      <div
        ref={viewportRef}
        role="group"
        aria-busy={!preview}
        aria-label="Mermaid diagram"
        className="my-3 overflow-hidden rounded-md border border-border bg-white"
      >
        <div className="flex min-h-40 items-center justify-center p-3">
          {expandable && preview?.status === "ready" ? (
            <DialogTrigger asChild>
              <button
                type="button"
                aria-label="Open diagram preview"
                className="group relative flex w-full cursor-zoom-in justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setOpenSvg(preview.svg)}
              >
                {diagram}
                <Expand
                  className="pointer-events-none absolute top-3 right-3 size-4 text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground dark:text-background/70 dark:group-hover:text-background dark:group-focus-visible:text-background"
                  aria-hidden="true"
                />
              </button>
            </DialogTrigger>
          ) : (
            diagram
          )}
          {preview?.status === "error" ? (
            <div className="flex items-start gap-2 text-sm text-destructive" role="alert">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium">Diagram preview failed</p>
                <p className="text-xs">
                  {preview.message} Edit the Mermaid source to fix the diagram.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {openSvg ? <MarkdownMermaidDialog svg={openSvg} /> : null}
    </Dialog>
  );
}
