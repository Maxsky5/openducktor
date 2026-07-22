import { TASK_ASSET_URI_PREFIX, type TaskAssetRenderContext } from "@openducktor/contracts";
import { lazy, memo, type ReactElement, type ReactNode, Suspense } from "react";
import Markdown, { type Components, defaultUrlTransform, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { getShellBridge } from "@/lib/shell-bridge";
import { cn } from "@/lib/utils";
import { hasMarkdownMath } from "./markdown-math-detection";
import { MARKDOWN_COMPONENTS, type MarkdownRendererVariant } from "./markdown-renderer-components";
import { prepareMarkdownRenderContent } from "./markdown-renderer-context";

const PremiumMarkdownRenderer = lazy(() => import("./markdown-renderer-premium"));
const MarkdownRendererRich = lazy(() => import("./markdown-renderer-rich"));
const MarkdownRendererMath = lazy(() => import("./markdown-renderer-math"));

export type { MarkdownRendererVariant } from "./markdown-renderer-components";

export type MarkdownPremiumRendererProps = {
  markdown: string;
  components: Components;
  fallback?: ReactNode;
};

type MarkdownRendererProps = {
  markdown: string;
  variant?: MarkdownRendererVariant;
  className?: string;
  components?: Components;
  premiumCodeBlocks?: boolean;
  fallback?: ReactNode;
  taskAssetContext?: Omit<TaskAssetRenderContext, "assetId">;
};

const REMARK_PLUGINS = [remarkGfm];
const MARKDOWN_URL_TRANSFORM: UrlTransform = (url) => defaultUrlTransform(url);

const MARKDOWN_CLASSES: Record<MarkdownRendererVariant, string> = {
  compact: cn(
    "markdown-body prose prose-sm max-w-none text-[13px] leading-relaxed text-foreground",
    "prose-headings:my-1 prose-headings:text-sm prose-headings:font-semibold prose-headings:text-foreground",
    "prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0",
    "prose-strong:text-foreground prose-em:text-foreground prose-li:text-foreground",
    "prose-hr:border-input prose-th:border-input prose-td:border-input",
    "prose-code:rounded-md prose-code:px-1 prose-code:text-[11px] prose-code:font-medium prose-code:text-rose-600 prose-code:dark:text-rose-400",
    "prose-code:before:content-none prose-code:after:content-none",
    "prose-pre:my-2 prose-pre:text-[11px] prose-pre:text-foreground",
    "prose-blockquote:my-2 prose-blockquote:border-input prose-blockquote:bg-muted/30 prose-blockquote:px-3 prose-blockquote:py-1 prose-blockquote:text-foreground",
  ),
  document: cn(
    "markdown-body prose max-w-none text-sm leading-relaxed text-foreground",
    "prose-headings:text-foreground prose-headings:font-semibold",
    "prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
    "prose-strong:text-foreground prose-em:text-foreground prose-li:text-foreground",
    "prose-hr:my-4 prose-hr:border-input",
    "prose-table:my-3 prose-th:border-input prose-td:border-input",
    "prose-code:rounded-md prose-code:px-1 prose-code:text-[12px] prose-code:font-medium prose-code:text-rose-600 prose-code:dark:text-rose-400",
    "prose-code:before:content-none prose-code:after:content-none",
    "prose-pre:my-3 prose-pre:bg-transparent prose-pre:p-0 prose-pre:text-foreground",
    "prose-blockquote:border-input prose-blockquote:bg-muted/30 prose-blockquote:px-3 prose-blockquote:py-1 prose-blockquote:text-foreground",
  ),
};

const MarkdownSync = memo(function MarkdownSync({
  markdown,
  components,
}: {
  markdown: string;
  components: Components;
}): ReactElement {
  return (
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      skipHtml
      urlTransform={MARKDOWN_URL_TRANSFORM}
      components={components}
    >
      {markdown}
    </Markdown>
  );
});

export const MarkdownRenderer = memo(function MarkdownRenderer({
  markdown,
  variant = "document",
  className,
  components: componentOverrides,
  premiumCodeBlocks = false,
  fallback,
  taskAssetContext,
}: MarkdownRendererProps): ReactElement | null {
  const content = prepareMarkdownRenderContent(markdown);
  if (!content) {
    return null;
  }

  const components = componentOverrides
    ? { ...MARKDOWN_COMPONENTS[variant], ...componentOverrides }
    : MARKDOWN_COMPONENTS[variant];
  const rendersMath = hasMarkdownMath(content);
  const rendersMermaid = /^[ \t]{0,3}(?:```|~~~)[ \t]*mermaid(?:[ \t]|$)/im.test(content);
  const rendersTaskAsset = content.includes(TASK_ASSET_URI_PREFIX);
  const needsRichRenderer = rendersMermaid || rendersTaskAsset || taskAssetContext !== undefined;
  const resolveTaskAssetSrc = taskAssetContext ? getShellBridge().resolveTaskAssetSrc : undefined;

  let renderedContent: ReactElement;
  if (rendersMath) {
    renderedContent = (
      <Suspense fallback={fallback ?? null}>
        <MarkdownRendererMath
          markdown={content}
          components={components}
          premiumCodeBlocks={premiumCodeBlocks}
          fallback={fallback}
          {...(taskAssetContext ? { taskAssetContext } : {})}
          {...(resolveTaskAssetSrc ? { resolveTaskAssetSrc } : {})}
        />
      </Suspense>
    );
  } else if (needsRichRenderer) {
    renderedContent = (
      <Suspense fallback={fallback ?? null}>
        <MarkdownRendererRich
          markdown={content}
          components={components}
          premiumCodeBlocks={premiumCodeBlocks}
          fallback={fallback}
          {...(taskAssetContext ? { taskAssetContext } : {})}
          {...(resolveTaskAssetSrc ? { resolveTaskAssetSrc } : {})}
        />
      </Suspense>
    );
  } else if (premiumCodeBlocks) {
    renderedContent = (
      <Suspense fallback={fallback ?? null}>
        <PremiumMarkdownRenderer markdown={content} components={components} fallback={fallback} />
      </Suspense>
    );
  } else {
    renderedContent = <MarkdownSync markdown={content} components={components} />;
  }

  return <div className={cn(MARKDOWN_CLASSES[variant], className)}>{renderedContent}</div>;
});
