import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

/** True when remark-math, the parser of the visual editor checks, finds math in the text. */
export const hasMarkdownMath = (markdown: string): boolean => {
  const tree = unified().use(remarkParse).use(remarkMath).parse(markdown);
  let found = false;
  visit(tree, (node) => {
    found ||= node.type === "math" || node.type === "inlineMath";
  });
  return found;
};
