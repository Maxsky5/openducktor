import { Minimize2, Minus, Plus, X } from "lucide-react";
import { type PointerEvent, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./button";
import { DialogClose, DialogContent, DialogDescription, DialogTitle } from "./dialog";

type DiagramSize = { width: number; height: number };
const controlClassName = "size-8 text-muted-foreground hover:text-foreground";

const VIEW_BOX = /^<svg\b[^>]*?\sviewBox="[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/;

/** The size of a Pele drawing, from the `viewBox` that Pele writes on its root tag. */
function readDiagramSize(svg: string): DiagramSize | null {
  const viewBox = VIEW_BOX.exec(svg.trimStart());
  const width = Number(viewBox?.[1]);
  const height = Number(viewBox?.[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function MarkdownMermaidDialog({
  svg,
  onCloseAutoFocus,
}: {
  svg: string;
  onCloseAutoFocus?: (event: Event) => void;
}): ReactElement {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [viewportSize, setViewportSize] = useState<DiagramSize | null>(null);
  const [zoom, setZoom] = useState(1);
  const diagramSize = useMemo(() => readDiagramSize(svg), [svg]);
  const markup = useMemo(() => ({ __html: svg }), [svg]);

  useEffect(() => {
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewport]);

  const fitScale =
    diagramSize && viewportSize?.width && viewportSize.height
      ? Math.min(viewportSize.width / diagramSize.width, viewportSize.height / diagramSize.height)
      : 0;
  const width = diagramSize ? diagramSize.width * fitScale * zoom : 0;
  const height = diagramSize ? diagramSize.height * fitScale * zoom : 0;
  const hasPreviewError = !diagramSize;
  const canShowDiagram = !hasPreviewError && fitScale > 0;

  const fit = () => {
    setZoom(1);
    viewport?.scrollTo(0, 0);
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    if (!viewport) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    viewport.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !viewport) return;
    viewport.scrollLeft = drag.left - (event.clientX - drag.x);
    viewport.scrollTop = drag.top - (event.clientY - drag.y);
  };

  const stopDrag = () => {
    dragRef.current = null;
  };

  return (
    <DialogContent
      closeButton={null}
      onCloseAutoFocus={onCloseAutoFocus}
      className="my-0 h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] gap-0 bg-background p-0 outline-none"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <DialogTitle>Diagram preview</DialogTitle>
          <DialogDescription className="sr-only">
            Zoom in or out, then scroll or drag to inspect the diagram.
          </DialogDescription>
        </div>
        <div
          className="flex shrink-0 items-center gap-1"
          role="group"
          aria-label="Diagram controls"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={controlClassName}
            aria-label="Zoom out"
            title="Zoom out"
            disabled={zoom <= 0.25}
            onClick={() => setZoom((value) => Math.max(0.25, value / 1.5))}
          >
            <Minus className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={controlClassName}
            aria-label="Zoom in"
            title="Zoom in"
            disabled={zoom >= 8}
            onClick={() => setZoom((value) => Math.min(8, value * 1.5))}
          >
            <Plus className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={controlClassName}
            aria-label="Fit diagram"
            title="Fit diagram"
            onClick={fit}
          >
            <Minimize2 className="size-4" aria-hidden="true" />
          </Button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={controlClassName}
              aria-label="Close diagram preview"
              title="Close diagram preview"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </DialogClose>
        </div>
      </div>
      <div
        ref={setViewport}
        tabIndex={0}
        role="region"
        aria-label="Diagram preview viewport"
        className="min-h-0 flex-1 overflow-auto bg-(--diagram-canvas) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        {hasPreviewError && (
          <p className="p-4 text-sm text-destructive" role="alert">
            The diagram preview could not load. Close it and try the diagram again.
          </p>
        )}
        {canShowDiagram && (
          <div
            className="flex items-center justify-center"
            style={{
              minWidth: Math.max(viewportSize?.width ?? 0, width),
              minHeight: Math.max(viewportSize?.height ?? 0, height),
            }}
          >
            <div
              role="img"
              aria-label="Expanded Mermaid diagram"
              className="shrink-0 select-none [&>svg]:h-full! [&>svg]:w-full! [&>svg]:max-w-none!"
              style={{ width, height }}
              // oxlint-disable-next-line react/no-danger -- Pele escapes diagram text and filters links and styles
              dangerouslySetInnerHTML={markup}
            />
          </div>
        )}
      </div>
    </DialogContent>
  );
}
