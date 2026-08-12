import type { TaskAssetRenderContext } from "@openducktor/contracts";
import type { ReactElement, ReactNode } from "react";
import type { Components } from "react-markdown";
import type { ShellBridge } from "@/lib/shell-bridge";
import { hasMarkdownMath } from "./markdown-math-detection";
import { hasMarkdownMermaid } from "./markdown-mermaid-detection";
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

  const Renderer = hasMarkdownMath(markdown) ? MarkdownRendererMath : MarkdownRendererRich;
  return (
    <Renderer
      markdown={markdown}
      components={components}
      premiumCodeBlocks={premiumCodeBlocks}
      fallback={fallback}
      {...(taskAssetContext ? { taskAssetContext } : {})}
      {...(resolveTaskAssetSrc ? { resolveTaskAssetSrc } : {})}
    />
  );
}
