import "katex/dist/katex.min.css";
import type { Root } from "hast";
import rehypeKatex from "rehype-katex";
import { unified } from "unified";

export type DrawMath = (tree: Root) => void;

const katex = unified().use(rehypeKatex);

/** Draws the math of a block tree with KaTeX, in place. A block loads this module when it shows math. */
export const drawMath: DrawMath = (tree) => {
  katex.runSync(tree);
};
