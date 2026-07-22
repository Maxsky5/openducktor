import type { TaskAssetRenderContext } from "@openducktor/contracts";
import { lazy, type ReactElement, type ReactNode, Suspense } from "react";
import type { Components } from "react-markdown";
import type { ShellBridge } from "@/lib/shell-bridge";
import { hasMarkdownMath } from "./markdown-math-detection";

const MarkdownRendererMath = lazy(() => import("./markdown-renderer-math"));

export default function MarkdownRendererMathCandidate({
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
  if (!hasMarkdownMath(markdown)) {
    return fallbackContent;
  }

  return (
    <Suspense fallback={fallback ?? null}>
      <MarkdownRendererMath
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
