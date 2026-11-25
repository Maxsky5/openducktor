import { AlertCircle, Expand } from "lucide-react";
import { useMemo, useState } from "react";
import { useOnSessionViewHide } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import { Dialog, DialogTrigger } from "./dialog";
import { drawDiagram, useDiagramRenderer } from "./markdown-diagram";
import { MarkdownMermaidDialog } from "./markdown-mermaid-dialog";

function DiagramAlert({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action: string;
}) {
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
export function MarkdownMermaid({
  source,
  expandable = false,
}: {
  source: string;
  expandable?: boolean;
}) {
  const renderer = useDiagramRenderer(true);
  const drawn = useMemo(
    () => (renderer.status === "ready" ? drawDiagram(renderer.value, source) : null),
    [renderer, source],
  );
  const [openSvg, setOpenSvg] = useState<string | null>(null);
  // A diagram dialog sits outside the hidden view, so a switch closes it.
  useOnSessionViewHide(() => setOpenSvg(null));
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
    content = (
      <DiagramAlert
        title="Diagram renderer failed to load"
        message={renderer.message}
        action="Reload the app to show diagrams."
      />
    );
  } else if (drawn?.status === "error") {
    content = (
      <DiagramAlert
        title="Diagram preview failed"
        message={drawn.message}
        action="Edit the Mermaid source to fix the diagram."
      />
    );
  } else if (expandable && drawn?.status === "ready") {
    const svg = drawn.svg;
    content = (
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Open diagram preview"
          className="group relative flex w-full cursor-zoom-in justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setOpenSvg(svg)}
        >
          {diagram}
          <Expand
            className="pointer-events-none absolute top-3 right-3 size-4 text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground"
            aria-hidden="true"
          />
        </button>
      </DialogTrigger>
    );
  }

  return (
    <Dialog open={openSvg !== null} onOpenChange={(open) => !open && setOpenSvg(null)}>
      <div
        role="group"
        aria-busy={renderer.status === "loading"}
        aria-label="Mermaid diagram"
        className="my-3 overflow-hidden rounded-xl border border-border bg-card"
      >
        <div className="flex min-h-40 items-center justify-center p-3">{content}</div>
      </div>
      {openSvg ? <MarkdownMermaidDialog svg={openSvg} /> : null}
    </Dialog>
  );
}
