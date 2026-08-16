import { AlertCircle } from "lucide-react";
import { createContext, type ReactNode, useContext, useId, useLayoutEffect, useState } from "react";
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
}: {
  source: string;
  renderDelayMs?: number;
}) {
  const reactId = useId();
  const preparedPreview = useContext(MermaidPreviewContext)?.get(source);
  const [state, setState] = useState<MermaidPreview | null>(preparedPreview ?? null);

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

  return (
    <section
      aria-busy={!preview}
      aria-label="Mermaid diagram"
      className="my-3 h-80 overflow-hidden rounded-md border border-border bg-card sm:h-96"
    >
      <div className="flex h-full items-center justify-center overflow-auto p-3">
        {preview?.status === "ready" ? (
          <div
            className="flex size-full items-center justify-center overflow-auto [&_svg]:max-h-full [&_svg]:max-w-full"
            // The SVG comes from Mermaid strict mode and passes through DOMPurify.
            dangerouslySetInnerHTML={{ __html: preview.svg }}
          />
        ) : null}
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
  );
}
