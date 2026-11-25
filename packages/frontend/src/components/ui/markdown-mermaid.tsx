import { AlertCircle } from "lucide-react";
import { type ReactElement, useDeferredValue, useMemo } from "react";
import {
  type DiagramFailure,
  type DiagramRenderer,
  type DrawnDiagram,
  drawDiagram,
  rendererFailure,
  sourceFailure,
  useDiagramRenderer,
} from "./markdown-diagram";

function DiagramAlert({ title, message, action }: DiagramFailure): ReactElement {
  return (
    <div className="flex items-start gap-2 text-sm text-destructive" role="alert">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="whitespace-pre-wrap font-mono text-xs">{message}</p>
        <p className="text-xs">{action}</p>
      </div>
    </div>
  );
}

function DiagramContent({
  renderer,
  drawn,
}: {
  renderer: DiagramRenderer;
  drawn: DrawnDiagram | null;
}): ReactElement | null {
  if (renderer.status === "loading") {
    return <p className="text-sm text-muted-foreground">Loading diagram…</p>;
  }
  if (renderer.status === "failed") return <DiagramAlert {...rendererFailure(renderer.message)} />;
  if (drawn?.status === "error") return <DiagramAlert {...sourceFailure(drawn.message)} />;
  if (drawn?.status !== "ready") return null;
  return (
    <span
      className="flex w-full justify-center [&_svg]:h-auto [&_svg]:max-w-full"
      // oxlint-disable-next-line react/no-danger -- Pele escapes diagram text and filters links and styles
      dangerouslySetInnerHTML={{ __html: drawn.svg }}
    />
  );
}

/** A Mermaid diagram outside a Markdown view, such as the diagram node of the visual editor. */
export function MarkdownMermaid({ source }: { source: string }): ReactElement {
  const renderer = useDiagramRenderer(true);
  // The editor draws the source after each keystroke commit, not inside it.
  const deferredSource = useDeferredValue(source);
  const drawn = useMemo(
    () => (renderer.status === "ready" ? drawDiagram(renderer.value, deferredSource) : null),
    [renderer, deferredSource],
  );

  return (
    <div
      role="group"
      aria-busy={renderer.status === "loading"}
      aria-label="Mermaid diagram"
      className="my-3 overflow-hidden rounded-xl border border-border bg-(--diagram-canvas)"
    >
      <div className="flex min-h-40 items-center justify-center p-3">
        <DiagramContent renderer={renderer} drawn={drawn} />
      </div>
    </div>
  );
}
