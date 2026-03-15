import { lazy, memo, type ReactElement, Suspense } from "react";
import type { MarkdownRendererProps } from "./markdown-renderer-core";

export type {
  MarkdownPremiumRendererProps,
  MarkdownRendererVariant,
} from "./markdown-renderer-core";

const MarkdownRendererCore = lazy(() => import("./markdown-renderer-core"));

export const MarkdownRenderer = memo(function MarkdownRenderer({
  markdown,
  variant = "document",
  className,
  premiumCodeBlocks = false,
  fallback,
}: MarkdownRendererProps): ReactElement | null {
  if (markdown.trim().length === 0) {
    return null;
  }

  return (
    <Suspense fallback={fallback ?? null}>
      <MarkdownRendererCore
        markdown={markdown}
        variant={variant}
        premiumCodeBlocks={premiumCodeBlocks}
        {...(className ? { className } : {})}
        {...(fallback !== undefined ? { fallback } : {})}
      />
    </Suspense>
  );
});
