import { AlertCircle, LoaderCircle } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { renderMermaidSvg } from "./markdown-mermaid-render";

type MermaidState =
  | { status: "loading" }
  | { status: "ready"; svg: string }
  | { status: "error"; message: string };

export function MarkdownMermaid({
  source,
  renderDelayMs = 0,
}: {
  source: string;
  renderDelayMs?: number;
}) {
  const reactId = useId();
  const [state, setState] = useState<MermaidState>({ status: "loading" });

  useEffect(() => {
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
            message:
              cause instanceof Error ? cause.message : "Mermaid could not parse this diagram.",
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
  }, [reactId, renderDelayMs, source]);

  return (
    <section className="my-3 overflow-hidden rounded-md border border-border bg-card">
      <div className="p-3">
        {state.status === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            Rendering diagram…
          </div>
        ) : null}
        {state.status === "ready" ? (
          <div
            className="overflow-x-auto [&_svg]:mx-auto [&_svg]:max-w-full"
            // The SVG comes from Mermaid strict mode and passes through DOMPurify.
            // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized Mermaid SVG must be inserted as markup to render.
            dangerouslySetInnerHTML={{ __html: state.svg }}
          />
        ) : null}
        {state.status === "error" ? (
          <div className="flex items-start gap-2 text-sm text-destructive" role="alert">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Diagram preview failed</p>
              <p className="text-xs">{state.message} Edit the Mermaid source to fix the diagram.</p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
