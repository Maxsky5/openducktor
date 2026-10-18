/**
 * Parses Markdown into top-level blocks. Streamed text grows at its end, so each update parses
 * only the last two blocks again: new text on the last line can join them.
 */
import type { Definition, FootnoteDefinition, Nodes, RootContent } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { SKIP, visit } from "unist-util-visit";
import { MATH_REMARK_PLUGINS } from "./markdown-math-plugins";

/** One top-level block of a Markdown text, without the blank lines around it. */
export type ParsedBlock = {
  text: string;
  /** Offset in the whole text where the block starts. */
  start: number;
  node: RootContent;
  linkIds: readonly string[];
  /** Footnote references in text order, without the references inside footnote definitions. */
  footnoteIds: readonly string[];
  /** True when the block shows math, which needs KaTeX. */
  hasMath: boolean;
  /** True when the text ends in this block, inside a code fence that is not closed yet. */
  endsInOpenFence: boolean;
};

export type ParsedDefinition = {
  /** Offset in the whole text where the definition starts. */
  start: number;
  /** Text of the definition. An unchanged text gives the same definition. */
  source: string;
  node: Definition | FootnoteDefinition;
  /** True when the definition shows math. Only a footnote definition can. */
  hasMath: boolean;
};

export type ParsedMarkdown = {
  markdown: string;
  blocks: readonly ParsedBlock[];
  /** Link and footnote definitions in text order, also those in quotes and lists. */
  definitions: readonly ParsedDefinition[];
};

/**
 * Parses `markdown`. When the text before the second-to-last block of `previous` is unchanged,
 * the function keeps the blocks in that text and parses only the rest.
 */
export const parseMarkdown = (
  markdown: string,
  previous: ParsedMarkdown | null,
): ParsedMarkdown => {
  const tailStart = previous?.blocks.at(-2)?.start ?? 0;
  if (previous === null || !markdown.startsWith(previous.markdown.slice(0, tailStart))) {
    return { markdown, ...parseTail(markdown, 0, []) };
  }

  const tail = parseTail(markdown, tailStart, previous.definitions);
  const definitions = [
    ...previous.definitions.filter(({ start }) => start < tailStart),
    ...tail.definitions,
  ];
  if (definedIdsKey(definitions) !== definedIdsKey(previous.definitions)) {
    // A new or removed definition can change references in complete blocks.
    return { markdown, ...parseTail(markdown, 0, []) };
  }
  return { markdown, blocks: [...previous.blocks.slice(0, -2), ...tail.blocks], definitions };
};

// The syntax of the other views that show math. Math syntax keeps a display equation with blank
// lines in one block.
const markdownParser = unified().use(remarkParse).use(MATH_REMARK_PLUGINS);

/**
 * Parses the text from `tailStart` on. Stub definitions for the identifiers in `definitions` come
 * first, because a reference parses as a reference only when its definition exists. Their
 * destination does not matter.
 */
const parseTail = (
  markdown: string,
  tailStart: number,
  definitions: readonly ParsedDefinition[],
): Omit<ParsedMarkdown, "markdown"> => {
  const tail = markdown.slice(tailStart);
  const prefix = stubPrefix(definitions);
  const text = `${prefix}${tail}`;
  const tree = markdownParser.parse(text);
  // The plugins change the tree in place.
  markdownParser.runSync(tree, text);
  // The stubs start before the tail.
  const nodes = tree.children.filter((node) => readOffsets(node, prefix.length).start >= 0);
  return {
    blocks: nodes.map((node, index) => {
      const { start, end } = readOffsets(node, prefix.length);
      const lineStart = index === 0 ? 0 : tail.lastIndexOf("\n", start - 1) + 1;
      const blockText = tail.slice(lineStart, end);
      return {
        text: blockText,
        start: tailStart + lineStart,
        node,
        ...readBlockFacts(node),
        endsInOpenFence: index === nodes.length - 1 && endsInOpenFence(node, blockText),
      };
    }),
    definitions: nodes.flatMap((node) => readDefinitions(node, tail, prefix.length, tailStart)),
  };
};

// A line that is not indented closes the last stub, so an indented block after the stubs stays code.
const STUB_END = "\n\n<!-- -->\n\n";

const stubPrefix = (definitions: readonly ParsedDefinition[]): string => {
  const stubs = new Set(
    definitions.map(({ node }) =>
      node.type === "footnoteDefinition" ? `[^${node.identifier}]: x` : `[${node.identifier}]: x`,
    ),
  );
  return stubs.size === 0 ? "" : `${[...stubs].join("\n\n")}${STUB_END}`;
};

const readBlockFacts = (
  node: RootContent,
): Pick<ParsedBlock, "linkIds" | "footnoteIds" | "hasMath"> => {
  const linkIds: string[] = [];
  const footnoteIds: string[] = [];
  let hasMath = false;
  visit(node, (child) => {
    // Footnote definitions render in the footnote list, not in the block.
    if (child.type === "footnoteDefinition") {
      return SKIP;
    }
    if (child.type === "linkReference" || child.type === "imageReference") {
      linkIds.push(child.identifier);
    }
    if (child.type === "footnoteReference") {
      footnoteIds.push(child.identifier);
    }
    hasMath ||= isMath(child);
    return undefined;
  });
  return { linkIds, footnoteIds, hasMath };
};

// Container markers and indentation can come before a closing fence line.
const CLOSING_FENCE_LINE = /^[\s>]*(`{3,}|~{3,})[ \t]*$/;

/**
 * The block ends in an open fence when its last node is code and its last line is not a closing
 * fence. A closing fence line is not part of the code value, but a content line is.
 */
const endsInOpenFence = (node: RootContent, text: string): boolean => {
  const last = lastDescendant(node);
  if (last.type !== "code") {
    return false;
  }
  const fence = CLOSING_FENCE_LINE.exec(text.slice(text.lastIndexOf("\n") + 1))?.[1];
  return fence === undefined || last.value.endsWith(fence);
};

const lastDescendant = (node: Nodes): Nodes => {
  const child = "children" in node ? node.children.at(-1) : undefined;
  return child === undefined ? node : lastDescendant(child);
};

const readDefinitions = (
  node: RootContent,
  tail: string,
  prefixLength: number,
  tailStart: number,
): ParsedDefinition[] => {
  const definitions: ParsedDefinition[] = [];
  visit(node, (child) => {
    if (child.type !== "definition" && child.type !== "footnoteDefinition") {
      return undefined;
    }
    const { start, end } = readOffsets(child, prefixLength);
    definitions.push({
      start: tailStart + start,
      source: tail.slice(start, end),
      node: child,
      hasMath: containsMath(child),
    });
    return SKIP;
  });
  return definitions;
};

const containsMath = (node: Nodes): boolean => {
  let found = false;
  visit(node, (child) => {
    found ||= isMath(child);
  });
  return found;
};

const isMath = (node: Nodes): boolean => node.type === "math" || node.type === "inlineMath";

const definedIdsKey = (definitions: readonly ParsedDefinition[]): string =>
  [...new Set(definitions.map(({ node }) => `${node.type}:${node.identifier}`))].sort().join("\n");

type Offsets = { start: number; end: number };

const readOffsets = (node: Nodes, prefixLength: number): Offsets => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    throw new Error(`remark-parse returned a "${node.type}" node without source offsets.`);
  }
  return { start: start - prefixLength, end: end - prefixLength };
};
