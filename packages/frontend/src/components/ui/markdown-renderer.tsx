import { lazy, memo, type ReactElement, type ReactNode, Suspense } from "react";
import Markdown, { type Components, defaultUrlTransform, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const PremiumMarkdownRenderer = lazy(() => import("./markdown-renderer-premium"));

export type MarkdownRendererVariant = "compact" | "document";

export type MarkdownPremiumRendererProps = {
  markdown: string;
  components: Components;
  fallback?: ReactNode;
};

type MarkdownRendererProps = {
  markdown: string;
  variant?: MarkdownRendererVariant;
  className?: string;
  premiumCodeBlocks?: boolean;
  fallback?: ReactNode;
};

const REMARK_PLUGINS = [remarkGfm];
const MARKDOWN_URL_TRANSFORM: UrlTransform = (url) => defaultUrlTransform(url);

const SHARED_COMPONENTS: Components = {
  a: ({ node: _node, className, href, ...props }) => (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "text-foreground underline decoration-muted-foreground underline-offset-2 transition hover:decoration-foreground",
        className,
      )}
    />
  ),
};

const COMPACT_COMPONENTS: Components = {
  ...SHARED_COMPONENTS,
  pre: ({ node: _node, className, ...props }) => (
    <pre {...props} className={cn("overflow-x-auto bg-transparent p-0", className)} />
  ),
};

const DOCUMENT_COMPONENTS: Components = {
  ...SHARED_COMPONENTS,
  pre: ({ node: _node, className, ...props }) => (
    <pre {...props} className={cn("overflow-x-auto", className)} />
  ),
};

const MARKDOWN_COMPONENTS: Record<MarkdownRendererVariant, Components> = {
  compact: COMPACT_COMPONENTS,
  document: DOCUMENT_COMPONENTS,
};

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
  premiumCodeBlocks = false,
  fallback,
}: MarkdownRendererProps): ReactElement | null {
  const content = markdown.trim();
  if (!content) {
    return null;
  }

  const components = MARKDOWN_COMPONENTS[variant];
  return (
    <div className={cn(MARKDOWN_CLASSES[variant], className)}>
      {premiumCodeBlocks ? (
        <Suspense fallback={fallback ?? null}>
          <PremiumMarkdownRenderer markdown={content} components={components} fallback={fallback} />
        </Suspense>
      ) : (
        <MarkdownSync markdown={content} components={components} />
      )}
    </div>
  );
});
