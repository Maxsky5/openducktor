import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { MarkdownMermaid } from "@/components/ui/markdown-mermaid";

const MERMAID_PREVIEW_RENDER_DELAY_MS = 250;

export function TaskDescriptionMermaidNode({ node }: ReactNodeViewProps) {
  if (node.attrs.language !== "mermaid") {
    return (
      <NodeViewWrapper className="my-3 rounded-md border border-border bg-muted/30">
        <NodeViewContent className="m-0 overflow-x-auto whitespace-pre p-3 font-mono text-xs" />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-3">
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
          Mermaid source
        </div>
        <NodeViewContent className="m-0 min-h-20 overflow-x-auto whitespace-pre p-3 font-mono text-xs" />
      </div>
      <MarkdownMermaid source={node.textContent} renderDelayMs={MERMAID_PREVIEW_RENDER_DELAY_MS} />
    </NodeViewWrapper>
  );
}
