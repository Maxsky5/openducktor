/**
 * Parses Markdown into top-level blocks. Streamed text grows at its end, so each update parses
 * only the last two blocks, or the last two items of a list, again. New text can join them.
 */
import type { Definition, FootnoteDefinition, List, Nodes, RootContent } from "mdast";
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
  /** The code of the fence that the text ends in, while that fence is not closed. */
  openFenceCode: string | null;
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
 * the function keeps the blocks in that text and parses only the rest. In an append-only list,
 * it also keeps the items before the last two items.
 */
export const parseMarkdown = (
  markdown: string,
  previous: ParsedMarkdown | null,
): ParsedMarkdown => {
  if (previous) {
    const listTail = parseListTail(markdown, previous);
    if (listTail) {
      return listTail;
    }
  }
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

// Offsets belong to the parse that made each node. Keep restart offsets in whole-text coordinates.
type ListTail = { start: number; prefixSpread: boolean };
const listTails = new WeakMap<ParsedBlock, ListTail>();

/** A list can join a following partial item, so consider either of the last two blocks. */
const parseListTail = (markdown: string, previous: ParsedMarkdown): ParsedMarkdown | null => {
  const lastIndex = previous.blocks.length - 1;
  const lastBlock = previous.blocks[lastIndex];
  const blockIndex = lastBlock && listTails.has(lastBlock) ? lastIndex : lastIndex - 1;
  const block = previous.blocks[blockIndex];
  const restart = block && listTails.get(block);
  if (
    !block ||
    block.node.type !== "list" ||
    restart === undefined ||
    block.node.children.length <= 2 ||
    !markdown.startsWith(previous.markdown)
  ) {
    return null;
  }
  const itemIndex = block.node.children.length - 2;
  // Task-list math can make local definitions whose source is the whole list, without item offsets.
  if (previous.definitions.some((entry) => entry.start >= block.start && !definesForText(entry))) {
    return null;
  }

  const tail = parseTail(markdown, restart.start, previous.definitions);
  const first = tail.blocks[0];
  if (!first || first.node.type !== "list") {
    return null;
  }
  const definitions = [
    ...previous.definitions.filter(({ start }) => start < restart.start),
    ...tail.definitions,
  ];
  if (
    tail.definitions.some((entry) => !definesForText(entry)) ||
    definedIdsKey(definitions) !== definedIdsKey(previous.definitions)
  ) {
    return { markdown, ...parseTail(markdown, 0, []) };
  }

  const node: typeof block.node = {
    ...block.node,
    spread: restart.prefixSpread || first.node.spread,
    children: [...block.node.children.slice(0, itemIndex), ...first.node.children],
  };
  const joined: ParsedBlock = {
    ...first,
    start: block.start,
    text: markdown.slice(block.start, first.start + first.text.length),
    node,
    ...readBlockFacts(node),
  };
  const nextRestart = listTails.get(first);
  if (nextRestart) {
    listTails.set(joined, {
      ...nextRestart,
      prefixSpread: restart.prefixSpread || nextRestart.prefixSpread,
    });
  }
  return {
    markdown,
    blocks: [...previous.blocks.slice(0, blockIndex), joined, ...tail.blocks.slice(1)],
    definitions,
  };
};

/** Includes the fixed gap before the second-last item, where the next parse starts. */
const listPrefixSpread = (list: List): boolean =>
  list.children.slice(1, -1).some((item, index) => {
    const previousEnd = list.children[index]?.position?.end.line;
    const itemStart = item.position?.start.line;
    if (previousEnd === undefined || itemStart === undefined) {
      throw new Error("remark-parse returned a list item without source lines.");
    }
    return itemStart > previousEnd + 1;
  });

const readLineStart = (text: string, offset: number): number => {
  let start = offset;
  while (start > 0 && text[start - 1] !== "\n" && text[start - 1] !== "\r") {
    start -= 1;
  }
  return start;
};

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
      const lineStart = index === 0 ? 0 : readLineStart(tail, start);
      const blockText = tail.slice(lineStart, end);
      const block: ParsedBlock = {
        text: blockText,
        start: tailStart + lineStart,
        node,
        ...readBlockFacts(node),
        openFenceCode: index === nodes.length - 1 ? readOpenFenceCode(node, blockText) : null,
      };
      const item = node.type === "list" ? node.children.at(-2) : undefined;
      if (node.type === "list" && item) {
        const itemStart = readOffsets(item, prefix.length).start;
        listTails.set(block, {
          start: tailStart + readLineStart(tail, itemStart),
          prefixSpread: listPrefixSpread(node),
        });
      }
      return block;
    }),
    definitions: nodes.flatMap((node) => readDefinitions(node, tail, prefix.length, tailStart)),
  };
};

// A line that is not indented closes the last stub, so an indented block after the stubs stays code.
const STUB_END = "\n\n<!-- -->\n\n";

const stubPrefix = (definitions: readonly ParsedDefinition[]): string => {
  const stubs = new Set(
    definitions
      .filter(definesForText)
      .map(({ node }) =>
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
const readOpenFenceCode = (node: RootContent, text: string): string | null => {
  const last = lastDescendant(node);
  if (last.type !== "code") {
    return null;
  }
  const fence = CLOSING_FENCE_LINE.exec(text.slice(readLineStart(text, text.length)))?.[1];
  return fence === undefined || last.value.endsWith(fence) ? last.value : null;
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
    // A definition from a reparsed task-list item body has no position. It takes the position and
    // text of its top-level block.
    const { start, end } = readOffsets(child.position ? child : node, prefixLength);
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

/**
 * The task-list math plugin parses an item body again apart from the text. The parse of the whole
 * text did not see a definition in that body, so the definition has no position and defines its
 * identifier only for references in the same body.
 */
const definesForText = ({ node }: ParsedDefinition): boolean => node.position !== undefined;

const definedIdsKey = (definitions: readonly ParsedDefinition[]): string =>
  [
    ...new Set(
      definitions.filter(definesForText).map(({ node }) => `${node.type}:${node.identifier}`),
    ),
  ]
    .sort()
    .join("\n");

type Offsets = { start: number; end: number };

const readOffsets = (node: Nodes, prefixLength: number): Offsets => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    throw new Error(`remark-parse returned a "${node.type}" node without source offsets.`);
  }
  return { start: start - prefixLength, end: end - prefixLength };
};
