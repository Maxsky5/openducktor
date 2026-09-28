import { Maximize2, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Button } from "./button";
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog";

type DiagramSize = { width: number; height: number };

function readDiagramSize(svg: string): DiagramSize | null {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (document.querySelector("parsererror")) return null;
  const root = document.documentElement;
  const viewBox = root
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const [, , viewBoxWidth, viewBoxHeight] = viewBox ?? [];
  if (
    viewBoxWidth &&
    viewBoxHeight &&
    Number.isFinite(viewBoxWidth) &&
    Number.isFinite(viewBoxHeight) &&
    viewBoxWidth > 0 &&
    viewBoxHeight > 0
  ) {
    return { width: viewBoxWidth, height: viewBoxHeight };
  }
  const width = Number.parseFloat(root.getAttribute("width") ?? "");
  const height = Number.parseFloat(root.getAttribute("height") ?? "");
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? { width, height }
    : null;
}

export function MarkdownMermaidDialog({ svg }: { svg: string }) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [viewportSize, setViewportSize] = useState<DiagramSize | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [zoom, setZoom] = useState(1);
  const diagramSize = useMemo(() => readDiagramSize(svg), [svg]);

  useEffect(() => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [svg]);

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

  return (
    <DialogContent className="my-0 h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] gap-3 bg-background">
      <DialogHeader>
        <DialogTitle>Diagram preview</DialogTitle>
        <DialogDescription className="sr-only">
          Zoom in or out, then scroll or drag to inspect the diagram.
        </DialogDescription>
      </DialogHeader>
      <div className="flex gap-2" role="group" aria-label="Diagram zoom controls">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Zoom out"
          disabled={zoom <= 0.25}
          onClick={() => setZoom((value) => Math.max(0.25, value / 1.5))}
        >
          <Minus aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Zoom in"
          disabled={zoom >= 8}
          onClick={() => setZoom((value) => Math.min(8, value * 1.5))}
        >
          <Plus aria-hidden="true" />
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={fit}>
          <Maximize2 aria-hidden="true" /> Fit
        </Button>
      </div>
      <div
        ref={setViewport}
        tabIndex={0}
        role="region"
        aria-label="Diagram preview viewport"
        className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      >
        {imageError || !diagramSize ? (
          <p className="p-4 text-sm text-destructive" role="alert">
            The diagram preview could not load. Close it and try the diagram again.
          </p>
        ) : imageUrl && fitScale > 0 ? (
          <div
            className="flex items-center justify-center"
            style={{
              minWidth: Math.max(viewportSize?.width ?? 0, width),
              minHeight: Math.max(viewportSize?.height ?? 0, height),
            }}
          >
            <img
              src={imageUrl}
              alt="Expanded Mermaid diagram"
              draggable={false}
              style={{ width, height, maxWidth: "none" }}
              onError={() => setImageError(true)}
            />
          </div>
        ) : null}
      </div>
    </DialogContent>
  );
}
