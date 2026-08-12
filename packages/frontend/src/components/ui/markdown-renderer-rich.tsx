import type { TaskAssetRenderContext } from "@openducktor/contracts";
import type { ReactElement, ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ShellBridge } from "@/lib/shell-bridge";
import {
  createTaskDescriptionComponents,
  TASK_DESCRIPTION_URL_TRANSFORM,
} from "./markdown-renderer-context";
import { usePremiumCodeComponents } from "./markdown-renderer-premium-code";

export default function MarkdownRendererRich({
  markdown,
  components,
  resolveTaskAssetSrc,
  taskAssetContext,
  premiumCodeBlocks = false,
  fallback,
}: {
  markdown: string;
  components: Components;
  resolveTaskAssetSrc?: ShellBridge["resolveTaskAssetSrc"];
  taskAssetContext?: Omit<TaskAssetRenderContext, "assetId">;
  premiumCodeBlocks?: boolean;
  fallback?: ReactNode;
}): ReactElement | null {
  const premiumComponents = usePremiumCodeComponents({
    components,
    enabled: premiumCodeBlocks,
    fallback,
  });
  const content = markdown.trim();
  if (!content) return null;
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      urlTransform={TASK_DESCRIPTION_URL_TRANSFORM}
      components={createTaskDescriptionComponents({
        components: premiumComponents,
        ...(resolveTaskAssetSrc ? { resolveTaskAssetSrc } : {}),
        ...(taskAssetContext ? { taskAssetContext } : {}),
      })}
    >
      {content}
    </Markdown>
  );
}
