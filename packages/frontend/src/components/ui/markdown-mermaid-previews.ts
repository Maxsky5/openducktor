import { getMarkdownMermaidSources } from "./markdown-mermaid-detection";
import { renderMermaidSvg } from "./markdown-mermaid-render";
import {
  getMermaidErrorMessage,
  type MermaidPreview,
  type MermaidPreviews,
} from "./markdown-mermaid-state";

export async function renderMermaidPreviews(sources: Iterable<string>): Promise<MermaidPreviews> {
  const previews = new Map<string, MermaidPreview>();
  for (const source of new Set(sources)) {
    try {
      const svg = await renderMermaidSvg(`odt-mermaid-prepared-${crypto.randomUUID()}`, source);
      previews.set(source, { status: "ready", svg });
    } catch (cause) {
      previews.set(source, { status: "error", message: getMermaidErrorMessage(cause) });
    }
  }
  return previews;
}

export const renderMarkdownMermaidPreviews = (markdown: string): Promise<MermaidPreviews> =>
  renderMermaidPreviews(getMarkdownMermaidSources(markdown));
