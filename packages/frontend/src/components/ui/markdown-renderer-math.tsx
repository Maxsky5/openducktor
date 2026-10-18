import { markdownLinkUrlTransform, type MarkdownLinkPolicy } from "./markdown-link-policy";
import "katex/dist/katex.min.css";
import type { TaskAssetRenderContext } from "@openducktor/contracts";
import type { ReactElement, ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import type { ShellBridge } from "@/lib/shell-bridge";
import {
  RICH_MARKDOWN_URL_TRANSFORM,
  useRichMarkdownComponents,
} from "./markdown-renderer-context";
import { usePremiumCodeComponents } from "./markdown-renderer-premium-code";
import { MATH_REMARK_PLUGINS } from "./markdown-math-plugins";

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
  const richComponents = useRichMarkdownComponents(premiumComponents, {
    resolveTaskAssetSource,
    taskAssetContext,
  });
  const content = markdown.trim();
  if (!content) return null;
  return (
    <Markdown
      remarkPlugins={MATH_REMARK_PLUGINS}
      rehypePlugins={[rehypeKatex]}
      skipHtml
      urlTransform={markdownLinkUrlTransform(RICH_MARKDOWN_URL_TRANSFORM, linkPolicy)}
      components={richComponents}
    >
      {content}
    </Markdown>
  );
}
