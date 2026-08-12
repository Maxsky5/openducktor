import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

export const getMarkdownMermaidSources = (markdown: string): string[] => {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const sources = new Set<string>();

  visit(tree, "code", (node) => {
    if (node.lang === "mermaid") {
      sources.add(node.value);
    }
  });

  return [...sources];
};

export const hasMarkdownMermaid = (markdown: string): boolean =>
  getMarkdownMermaidSources(markdown).length > 0;
