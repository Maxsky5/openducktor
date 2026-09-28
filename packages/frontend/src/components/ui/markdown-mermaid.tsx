import { AlertCircle, Expand } from "lucide-react";
import { createContext, type ReactNode, useContext, useId, useLayoutEffect, useState } from "react";
import { Dialog, DialogTrigger } from "./dialog";
import { MarkdownMermaidDialog } from "./markdown-mermaid-dialog";
import { renderMermaidSvg } from "./markdown-mermaid-render";
import {
  getMermaidErrorMessage,
  type MermaidPreview,
  type MermaidPreviews,
} from "./markdown-mermaid-state";

const MermaidPreviewContext = createContext<MermaidPreviews | null>(null);

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
  const [state, setState] = useState<MermaidPreview | null>(preparedPreview ?? null);
  const [openSvg, setOpenSvg] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (preparedPreview) {
      return;
    }
    let active = true;
    const renderDiagram = async (): Promise<void> => {
      try {
        const renderId = `odt-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}-${crypto.randomUUID()}`;
        const svg = await renderMermaidSvg(renderId, source);
        if (active) {
          setState({ status: "ready", svg });
        }
      } catch (cause) {
        if (active) {
          setState({
            status: "error",
            message: getMermaidErrorMessage(cause),
          });
        }
      }
    };
    if (renderDelayMs <= 0) {
      void renderDiagram();
      return () => {
        active = false;
      };
    }

    const renderTimeout = setTimeout(() => void renderDiagram(), renderDelayMs);
    return () => {
      active = false;
      clearTimeout(renderTimeout);
    };
  }, [preparedPreview, reactId, renderDelayMs, source]);

  const preview = preparedPreview ?? state;

  const diagram =
    preview?.status === "ready" ? (
      <span
        className="flex size-full items-center justify-center overflow-auto [&_svg]:max-h-full [&_svg]:max-w-full"
        // oxlint-disable-next-line react/no-danger -- Mermaid strict-mode output passes through DOMPurify
        dangerouslySetInnerHTML={{ __html: preview.svg }}
      />
    ) : null;

  return (
    <Dialog open={openSvg !== null} onOpenChange={(open) => !open && setOpenSvg(null)}>
      <section
        aria-busy={!preview}
        aria-label="Mermaid diagram"
        className="my-3 h-80 overflow-hidden rounded-md border border-border bg-card sm:h-96"
      >
        <div className="flex h-full items-center justify-center overflow-auto p-3">
          {expandable && preview?.status === "ready" ? (
            <DialogTrigger asChild>
              <button
                type="button"
                aria-label="Open diagram preview"
                className="relative flex size-full cursor-zoom-in items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setOpenSvg(preview.svg)}
              >
                {diagram}
                <span className="absolute top-2 right-2 flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground shadow-sm">
                  <Expand className="size-3" aria-hidden="true" /> Open preview
                </span>
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
      </section>
      {openSvg ? <MarkdownMermaidDialog svg={openSvg} /> : null}
    </Dialog>
  );
}
