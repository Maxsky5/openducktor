import type { TaskAssetRenderContext } from "@openducktor/contracts";
import { memo, type ReactElement } from "react";
import { prepareMarkdownRenderContent } from "./markdown-render-content";
import type { MarkdownLinks } from "./markdown-html";
import type { MarkdownRendererVariant } from "./markdown-variants";
import { type MarkdownImages, MarkdownView } from "./markdown-view";

export type { MarkdownRendererVariant } from "./markdown-variants";
export type { MarkdownImages } from "./markdown-view";

type MarkdownRendererProps = {
  markdown: string;
  variant?: MarkdownRendererVariant;
  className?: string;
  links?: MarkdownLinks;
  images?: MarkdownImages;
  taskAssetContext?: Omit<TaskAssetRenderContext, "assetId">;
  stripTaskDescriptionFrontMatter?: boolean;
  /** Shows math and diagram fences as text, for short previews. */
  lightweight?: boolean;
};

/** Renders a complete Markdown text, such as a task description or a workflow document. */
export const MarkdownRenderer = memo(function MarkdownRenderer({
  markdown,
  variant = "document",
  className,
  links,
  images,
  taskAssetContext,
  stripTaskDescriptionFrontMatter = false,
  lightweight = false,
}: MarkdownRendererProps): ReactElement | null {
  const content = prepareMarkdownRenderContent(markdown, stripTaskDescriptionFrontMatter);
  if (!content) return null;
  return (
    <MarkdownView
      markdown={content}
      streaming={false}
      variant={variant}
      className={className}
      lightweight={lightweight}
      links={links}
      images={images}
      taskAssetContext={taskAssetContext}
    />
  );
});
