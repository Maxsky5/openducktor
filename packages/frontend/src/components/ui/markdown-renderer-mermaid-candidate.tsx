import type { TaskAssetRenderContext } from "@openducktor/contracts";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import type { Components } from "react-markdown";
import type { ShellBridge } from "@/lib/shell-bridge";
import { hasMarkdownMath } from "./markdown-math-detection";
import { MermaidPreviewProvider } from "./markdown-mermaid";
import { hasMarkdownMermaid } from "./markdown-mermaid-detection";
import { renderMarkdownMermaidPreviews } from "./markdown-mermaid-previews";
import type { MermaidPreviews } from "./markdown-mermaid-state";
import MarkdownRendererMath from "./markdown-renderer-math";
import MarkdownRendererRich from "./markdown-renderer-rich";

export default function MarkdownRendererMermaidCandidate({
  markdown,
  components,
  fallbackContent,
  resolveTaskAssetSrc,
  taskAssetContext,
  premiumCodeBlocks = false,
  fallback,
}: {
  markdown: string;
  components: Components;
  fallbackContent: ReactElement;
  resolveTaskAssetSrc?: ShellBridge["resolveTaskAssetSrc"];
  taskAssetContext?: Omit<TaskAssetRenderContext, "assetId">;
  premiumCodeBlocks?: boolean;
  fallback?: ReactNode;
}): ReactElement {
  if (!hasMarkdownMermaid(markdown)) {
    return fallbackContent;
  }

  return (
    <PreparedMermaidRenderer
      markdown={markdown}
      components={components}
      premiumCodeBlocks={premiumCodeBlocks}
      fallback={fallback}
      {...(taskAssetContext ? { taskAssetContext } : {})}
      {...(resolveTaskAssetSrc ? { resolveTaskAssetSrc } : {})}
    />
  );
}

function PreparedMermaidRenderer({
  markdown,
  components,
  resolveTaskAssetSrc,
  taskAssetContext,
  premiumCodeBlocks,
  fallback,
}: {
  markdown: string;
  components: Components;
  resolveTaskAssetSrc?: ShellBridge["resolveTaskAssetSrc"];
  taskAssetContext?: Omit<TaskAssetRenderContext, "assetId">;
  premiumCodeBlocks: boolean;
  fallback?: ReactNode;
}): ReactElement | null {
  const [snapshot, setSnapshot] = useState<{
    markdown: string;
    previews: MermaidPreviews;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void renderMarkdownMermaidPreviews(markdown).then((previews) => {
      if (active) {
        setSnapshot({ markdown, previews });
      }
    });
    return () => {
      active = false;
    };
  }, [markdown]);

  if (!snapshot) {
    return null;
  }

  const Renderer = hasMarkdownMath(snapshot.markdown) ? MarkdownRendererMath : MarkdownRendererRich;
  return (
    <MermaidPreviewProvider previews={snapshot.previews}>
      <Renderer
        markdown={snapshot.markdown}
        components={components}
        premiumCodeBlocks={premiumCodeBlocks}
        fallback={fallback}
        {...(taskAssetContext ? { taskAssetContext } : {})}
        {...(resolveTaskAssetSrc ? { resolveTaskAssetSrc } : {})}
      />
    </MermaidPreviewProvider>
  );
}
