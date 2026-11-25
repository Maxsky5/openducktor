import type { ReactElement } from "react";
import type { MarkdownLinks } from "./markdown-html";
import type { MarkdownRendererVariant } from "./markdown-variants";
import { MarkdownView } from "./markdown-view";

type MarkdownStreamRendererProps = {
  markdown: string;
  /** True while the text grows at its end. */
  streaming: boolean;
  variant?: MarkdownRendererVariant;
  className?: string;
  links?: MarkdownLinks;
};

/**
 * Renders Markdown that can stream, such as an agent reply. Words keeps the blocks that are
 * complete and renders again only the end of the text.
 */
export function MarkdownStreamRenderer({
  markdown,
  streaming,
  variant = "document",
  className,
  links,
}: MarkdownStreamRendererProps): ReactElement {
  return (
    <MarkdownView
      markdown={markdown}
      streaming={streaming}
      variant={variant}
      className={className}
      lightweight={false}
      links={links}
    />
  );
}
