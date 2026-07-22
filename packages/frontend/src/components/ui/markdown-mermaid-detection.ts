import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

export const hasMarkdownMermaid = (markdown: string): boolean => {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  let found = false;

  visit(tree, "code", (node) => {
    if (node.lang === "mermaid") {
      found = true;
    }
  });

  return found;
};
