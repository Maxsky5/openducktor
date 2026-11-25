import { AlertCircle } from "lucide-react";
import { useDeferredValue, useMemo } from "react";
import {
  type DiagramFailure,
  drawDiagram,
  rendererFailure,
  sourceFailure,
  useDiagramRenderer,
} from "./markdown-diagram";

function DiagramAlert({ title, message, action }: DiagramFailure) {
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

/** A Mermaid diagram outside a Markdown view, such as the diagram node of the visual editor. */
export function MarkdownMermaid({ source }: { source: string }) {
  const renderer = useDiagramRenderer(true);
  // The editor draws the source after each keystroke commit, not inside it.
  const deferredSource = useDeferredValue(source);
  const drawn = useMemo(
    () => (renderer.status === "ready" ? drawDiagram(renderer.value, deferredSource) : null),
    [renderer, deferredSource],
  );
  const markup = useMemo(() => (drawn?.status === "ready" ? { __html: drawn.svg } : null), [drawn]);

  const diagram = markup ? (
    <span
      className="flex w-full justify-center [&_svg]:h-auto [&_svg]:max-w-full"
      // oxlint-disable-next-line react/no-danger -- Pele escapes diagram text and filters links and styles
      dangerouslySetInnerHTML={markup}
    />
  ) : null;

  let content = diagram;
  if (renderer.status === "loading") {
    content = <p className="text-sm text-muted-foreground">Loading diagram…</p>;
  } else if (renderer.status === "failed") {
    content = <DiagramAlert {...rendererFailure(renderer.message)} />;
  } else if (drawn?.status === "error") {
    content = <DiagramAlert {...sourceFailure(drawn.message)} />;
  }

  return (
    <div
      role="group"
      aria-busy={renderer.status === "loading"}
      aria-label="Mermaid diagram"
      className="my-3 overflow-hidden rounded-xl border border-border bg-(--diagram-canvas)"
    >
      <div className="flex min-h-40 items-center justify-center p-3">{content}</div>
    </div>
  );
}
