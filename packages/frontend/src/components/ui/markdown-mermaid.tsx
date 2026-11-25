import { type ReactElement, useDeferredValue, useMemo } from "react";
import { diagramHtml, useDiagramRenderer } from "./markdown-diagram";

/**
 * A Mermaid diagram outside a Markdown view, such as the diagram node of the visual editor. It
 * shows the same diagram, failure, and loading HTML as a view, without the preview.
 */
export function MarkdownMermaid({ source }: { source: string }): ReactElement {
  const renderer = useDiagramRenderer(true);
  // The editor draws the source after each keystroke commit, not inside it.
  const deferredSource = useDeferredValue(source);
  const html = useMemo(
    () => diagramHtml(renderer, deferredSource, false),
    [renderer, deferredSource],
  );

  return (
    <div
      role="group"
      aria-busy={renderer.status === "loading"}
      aria-label="Mermaid diagram"
      // oxlint-disable-next-line react/no-danger -- Pele escapes diagram text and draws no links, and the failure HTML escapes its text
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
