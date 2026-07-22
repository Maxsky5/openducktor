import type { TaskAssetRenderContext } from "@openducktor/contracts";
import { lazy, type ReactElement, type ReactNode, Suspense } from "react";
import type { Components } from "react-markdown";
import type { ShellBridge } from "@/lib/shell-bridge";
import { hasMarkdownMermaid } from "./markdown-mermaid-detection";

const MarkdownRendererRich = lazy(() => import("./markdown-renderer-rich"));

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
    <Suspense fallback={fallback ?? null}>
      <MarkdownRendererRich
        markdown={markdown}
        components={components}
        premiumCodeBlocks={premiumCodeBlocks}
        fallback={fallback}
        {...(taskAssetContext ? { taskAssetContext } : {})}
        {...(resolveTaskAssetSrc ? { resolveTaskAssetSrc } : {})}
      />
    </Suspense>
  );
}
