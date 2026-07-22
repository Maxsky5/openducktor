import { AlertCircle, LoaderCircle } from "lucide-react";
import { useEffect, useId, useState } from "react";

type MermaidState =
  | { status: "loading" }
  | { status: "ready"; svg: string }
  | { status: "error"; message: string };

let initialized = false;

export function MarkdownMermaid({
  source,
  showSource = true,
}: {
  source: string;
  showSource?: boolean;
}) {
  const reactId = useId();
  const [state, setState] = useState<MermaidState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    const renderDiagram = async (): Promise<void> => {
      try {
        const [mermaidModule, domPurifyModule] = await Promise.all([
          import("mermaid"),
          import("dompurify"),
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
        const svg = domPurifyModule.default.sanitize(rendered.svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
        });
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
      {showSource ? (
        <>
          <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
            Mermaid source
          </div>
          <pre className="m-0 overflow-x-auto rounded-none bg-transparent p-3 text-xs">
            <code>{source}</code>
          </pre>
        </>
      ) : null}
      <div className={showSource ? "border-t border-border p-3" : "p-3"}>
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
