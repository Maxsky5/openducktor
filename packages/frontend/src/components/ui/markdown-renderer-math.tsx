import { markdownLinkUrlTransform, type MarkdownLinkPolicy } from "./markdown-link-policy";
import "katex/dist/katex.min.css";
import type { TaskAssetRenderContext } from "@openducktor/contracts";
import type { ReactElement, ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { ShellBridge } from "@/lib/shell-bridge";
import {
  createTaskDescriptionComponents,
  TASK_DESCRIPTION_URL_TRANSFORM,
} from "./markdown-renderer-context";
import { usePremiumCodeComponents } from "./markdown-renderer-premium-code";
import { remarkTaskListBlockMath } from "./markdown-task-list-math";

export default function MarkdownRendererMath({
  markdown,
  components,
  linkPolicy,
  resolveTaskAssetSource,
  taskAssetContext,
  premiumCodeBlocks = false,
  fallback,
}: {
  markdown: string;
  components: Components;
  linkPolicy?: MarkdownLinkPolicy | undefined;
  resolveTaskAssetSource?: ShellBridge["resolveTaskAssetSource"];
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
  const componentInput: Parameters<typeof createTaskDescriptionComponents>[0] = {
    components: premiumComponents,
  };
  if (resolveTaskAssetSource) {
    componentInput.resolveTaskAssetSource = resolveTaskAssetSource;
  }
  if (taskAssetContext) {
    componentInput.taskAssetContext = taskAssetContext;
  }
  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkMath, remarkTaskListBlockMath]}
      rehypePlugins={[rehypeKatex]}
      skipHtml
      urlTransform={markdownLinkUrlTransform(TASK_DESCRIPTION_URL_TRANSFORM, linkPolicy)}
      components={createTaskDescriptionComponents(componentInput)}
    >
      {content}
    </Markdown>
  );
}
