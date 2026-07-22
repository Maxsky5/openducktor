import { AlertCircle, LoaderCircle } from "lucide-react";
import { useEffect, useId, useState } from "react";

type MermaidState =
  | { status: "loading" }
  | { status: "ready"; svg: string }
  | { status: "error"; message: string };

let initialized = false;

export function MarkdownMermaid({ source }: { source: string }) {
  const reactId = useId();
  const [state, setState] = useState<MermaidState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    const renderDiagram = async (): Promise<void> => {
      try {
        const [mermaidModule, sanitizeModule] = await Promise.all([
          import("mermaid"),
          import("./markdown-mermaid-sanitize"),
        ]);
        const mermaid = mermaidModule.default;
        if (!initialized) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            suppressErrorRendering: true,
          });
          initialized = true;
        }
        const renderId = `odt-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}-${crypto.randomUUID()}`;
        const rendered = await mermaid.render(renderId, source);
        const svg = sanitizeModule.sanitizeMermaidSvg(rendered.svg);
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
    void renderDiagram();
    return () => {
      active = false;
    };
  }, [reactId, source]);

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
