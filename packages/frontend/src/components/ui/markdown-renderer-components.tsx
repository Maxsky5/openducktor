import type { Components } from "react-markdown";
import { cn } from "@/lib/utils";

export type MarkdownRendererVariant = "compact" | "document";

const SHARED_COMPONENTS: Components = {
  a: ({ node: _node, children, className, href, ...props }) => (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "text-foreground underline decoration-muted-foreground underline-offset-2 transition hover:decoration-foreground",
        className,
      )}
    >
      {children}
    </a>
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

export const MARKDOWN_COMPONENTS: Record<MarkdownRendererVariant, Components> = {
  compact: COMPACT_COMPONENTS,
  document: DOCUMENT_COMPONENTS,
};
