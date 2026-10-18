import "katex/dist/katex.min.css";
import type { Root } from "hast";
import { type ReactElement, useMemo } from "react";
import rehypeKatex from "rehype-katex";
import { unified } from "unified";
import type { MarkdownStreamBlockProps } from "./markdown-stream-renderer";
import { renderMarkdownBlock } from "./markdown-stream-tree";

const katex = unified().use(rehypeKatex);

// rehype-katex changes the tree in place.
const drawMath = (tree: Root): void => {
  katex.runSync(tree);
};

/** Renders a block that shows math. This module loads KaTeX only when a block needs it. */
export default function MarkdownStreamMathBlock({
  content,
  components,
  urlTransform,
}: MarkdownStreamBlockProps): ReactElement {
  return useMemo(
    () => renderMarkdownBlock(content, components, urlTransform, drawMath),
    [components, content, urlTransform],
  );
}
