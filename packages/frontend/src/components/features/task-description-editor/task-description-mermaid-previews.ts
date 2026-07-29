import { renderMermaidPreviews } from "@/components/ui/markdown-mermaid-previews";
import type { MermaidPreviews } from "@/components/ui/markdown-mermaid-state";
import { getTaskDescriptionVisualMermaidSources } from "./task-description-markdown";

export const renderInitialTaskDescriptionMermaidPreviews = (
  markdown: string,
): Promise<MermaidPreviews> =>
  renderMermaidPreviews(getTaskDescriptionVisualMermaidSources(markdown));
