import { cn } from "@/lib/utils";

export type MarkdownRendererVariant = "compact" | "document";

/**
 * The text styles of each view variant. `markdown.css` styles the parts that Words adds, such as
 * code blocks.
 */
export const MARKDOWN_CLASSES = {
  compact: cn(
    "markdown-body prose prose-sm max-w-none text-[13px] leading-relaxed text-foreground",
    "prose-headings:my-1 prose-headings:text-sm prose-headings:font-semibold prose-headings:text-foreground",
    "prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0",
    "prose-strong:text-foreground prose-em:text-foreground prose-li:text-foreground",
    "prose-hr:border-input prose-th:border-input prose-td:border-input",
    "prose-code:rounded-md prose-code:px-1 prose-code:text-[11px] prose-code:font-medium prose-code:text-rose-600 prose-code:dark:text-rose-400",
    "prose-code:before:content-none prose-code:after:content-none",
    "prose-blockquote:my-2 prose-blockquote:border-input prose-blockquote:bg-muted/30 prose-blockquote:px-3 prose-blockquote:py-1 prose-blockquote:text-foreground",
  ),
  document: cn(
    "markdown-body prose max-w-none text-sm leading-relaxed text-foreground",
    "prose-headings:text-foreground prose-headings:font-semibold",
    "prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
    "prose-strong:text-foreground prose-em:text-foreground prose-li:text-foreground",
    "prose-hr:my-4 prose-hr:border-input",
    "prose-table:my-3 prose-th:border-input prose-td:border-input prose-td:wrap-anywhere",
    "prose-code:rounded-md prose-code:px-1 prose-code:text-[12px] prose-code:font-medium prose-code:text-rose-600 prose-code:dark:text-rose-400",
    "prose-code:before:content-none prose-code:after:content-none",
    "prose-blockquote:border-input prose-blockquote:bg-muted/30 prose-blockquote:px-3 prose-blockquote:py-1 prose-blockquote:text-foreground",
  ),
} satisfies Record<MarkdownRendererVariant, string>;
