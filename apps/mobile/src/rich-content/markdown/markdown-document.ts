/**
 * Parses Markdown into top-level blocks with `mdast-util-from-markdown`, GFM, and math.
 *
 * Streamed text grows at its end. When the new text starts with the old text, the parse keeps
 * the blocks before the last block and parses only the rest. It also parses the block before the
 * last block when new text can join them: no blank line separates them, or that block is a list
 * that a new item can continue. A block whose start and text stay the same keeps its object, so
 * memoized rows skip a render.
 *
 * Link and footnote definitions change references in other blocks, so a text with a definition
 * always parses in full.
 */
import type { Nodes, RootContent } from "mdast";
import { fromMarkdown, type Options } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { gfm } from "micromark-extension-gfm";
import { math } from "micromark-extension-math";
import { contentHash, createHostContentCache } from "../lru-cache";

/**
 * `math` and `diagram` blocks render in the isolated page view: `math` blocks show math, and
 * `diagram` blocks show a Mermaid diagram, which needs the larger diagram page.
 */
type MarkdownBlockRoute = "native" | "math" | "diagram";

export type MarkdownBlock = {
  /** The offset where the block starts. It is unique in one text and stays the same while text streams. */
  readonly key: string;
  readonly start: number;
  /** The block text, without the blank lines around it. */
  readonly source: string;
  readonly node: RootContent;
  readonly route: MarkdownBlockRoute;
  /**
   * True while the block ends the streamed text in a fenced code or math block without its
   * closing fence, also one inside a list or a quote. The fence text still grows, so it shows as
   * plain code until the fence closes, and the block stays native.
   */
  readonly streaming: boolean;
  /** True when the block defines a link or footnote target. */
  readonly definesTargets: boolean;
};

export type MarkdownDefinition = { readonly url: string; readonly title: string | null };

/** Link and image reference targets by their normalized identifier. */
export type MarkdownDefinitions = ReadonlyMap<string, MarkdownDefinition>;

export type MarkdownDocument = {
  readonly markdown: string;
  readonly blocks: readonly MarkdownBlock[];
  readonly definitions: MarkdownDefinitions;
};

const PARSE_OPTIONS: Options = {
  extensions: [gfm(), math()],
  mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
};

const NO_DEFINITIONS: MarkdownDefinitions = new Map();
const BLANK_LINE = /\n[ \t]*\n/;
const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,}|\${2,})/;
// Quote markers and list indentation can come before a fence line in a container.
const CONTAINER_PREFIX = /^[\s>]*/;

export const parseMarkdownDocument = (
  markdown: string,
  previous: MarkdownDocument | null,
): MarkdownDocument => {
  if (previous?.markdown === markdown) return previous;
  const tailIndex = previous === null ? null : reusableTailIndex(previous, markdown);
  if (previous === null || tailIndex === null) return fullDocument(markdown);

  const tailStart = previous.blocks[tailIndex]?.start ?? 0;
  const tail = parseBlocks(markdown, tailStart);
  if (tail.some((block) => block.definesTargets)) return fullDocument(markdown);
  const blocks = previous.blocks.slice(0, tailIndex);
  for (const [index, block] of tail.entries()) {
    const old = previous.blocks[tailIndex + index];
    const unchanged =
      old !== undefined &&
      old.start === block.start &&
      old.source === block.source &&
      old.route === block.route &&
      old.streaming === block.streaming;
    blocks.push(unchanged ? old : block);
  }
  return { markdown, blocks, definitions: previous.definitions };
};

/** The index of the first previous block to parse again, or `null` for a full parse. */
const reusableTailIndex = (previous: MarkdownDocument, markdown: string): number | null => {
  const { blocks } = previous;
  const last = blocks.at(-1);
  if (last === undefined || !markdown.startsWith(previous.markdown)) return null;
  if (blocks.some((block) => block.definesTargets)) return null;
  const lastIndex = blocks.length - 1;
  const before = blocks[lastIndex - 1];
  if (before === undefined) return lastIndex;
  const gap = previous.markdown.slice(before.start + before.source.length, last.start);
  return before.node.type === "list" || !BLANK_LINE.test(gap) ? lastIndex - 1 : lastIndex;
};

const fullDocument = (markdown: string): MarkdownDocument => {
  const blocks = parseBlocks(markdown, 0);
  return { markdown, blocks, definitions: readDefinitions(blocks) };
};

const parseBlocks = (markdown: string, tailStart: number): MarkdownBlock[] => {
  const tail = markdown.slice(tailStart);
  const nodes = fromMarkdown(tail, PARSE_OPTIONS).children;
  return nodes.map((node, index) => {
    const position = node.position;
    if (position?.start.offset === undefined || position.end.offset === undefined) {
      throw new Error("The Markdown parser returned a block without a source position.");
    }
    const offset = position.start.offset;
    const lineStart = offset === 0 ? 0 : tail.lastIndexOf("\n", offset - 1) + 1;
    const source = tail.slice(lineStart, position.end.offset);
    const facts = readBlockFacts(node);
    const streamingFence = index === nodes.length - 1 && endsInOpenFence(node, tail);
    const start = tailStart + lineStart;
    return {
      key: String(start),
      start,
      source,
      node,
      route: streamingFence ? "native" : facts.route,
      streaming: streamingFence,
      definesTargets: facts.definesTargets,
    };
  });
};

type BlockFacts = { route: MarkdownBlockRoute; definesTargets: boolean };

const readBlockFacts = (node: Nodes): BlockFacts => {
  const facts: BlockFacts = { route: "native", definesTargets: false };
  const visit = (current: Nodes): void => {
    if ((current.type === "math" || current.type === "inlineMath") && facts.route === "native") {
      facts.route = "math";
    }
    if (current.type === "code" && current.lang === "mermaid") facts.route = "diagram";
    if (current.type === "definition" || current.type === "footnoteDefinition") {
      facts.definesTargets = true;
    }
    if ("children" in current) for (const child of current.children) visit(child);
  };
  visit(node);
  return facts;
};

/** The last node in document order: the node itself, or the last descendant of its last child. */
export const lastDescendant = (node: Nodes): Nodes => {
  const child = "children" in node ? node.children.at(-1) : undefined;
  return child === undefined ? node : lastDescendant(child);
};

/**
 * True while the last block of a streamed text ends in a fenced code or math block without its
 * closing fence. The fence can be the block itself or the end of a list or quote. `text` is the
 * parsed text, which the node positions point into.
 */
const endsInOpenFence = (node: RootContent, text: string): boolean => {
  const fence = lastDescendant(node);
  if (fence.type !== "code" && fence.type !== "math") return false;
  const start = fence.position?.start.offset;
  const end = fence.position?.end.offset;
  if (start === undefined || end === undefined) {
    throw new Error("The Markdown parser returned a fence without a source position.");
  }
  const source = text.slice(start, end);
  const opening = OPENING_FENCE.exec(source)?.[1];
  if (opening === undefined) return false;
  const lines = source.split("\n");
  if (lines.length < 2) return true;
  const lastLine = lines.at(-1) ?? "";
  const closing = (fence === node ? lastLine : lastLine.replace(CONTAINER_PREFIX, "")).trim();
  const fenceCharacter = opening.charAt(0);
  const closes =
    closing.length >= opening.length &&
    [...closing].every((character) => character === fenceCharacter);
  return !closes;
};

const readDefinitions = (blocks: readonly MarkdownBlock[]): MarkdownDefinitions => {
  if (!blocks.some((block) => block.definesTargets)) return NO_DEFINITIONS;
  const definitions = new Map<string, MarkdownDefinition>();
  const visit = (node: Nodes): void => {
    // The first definition of an identifier wins, as in CommonMark.
    if (node.type === "definition" && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, { url: node.url, title: node.title ?? null });
    }
    if ("children" in node) for (const child of node.children) visit(child);
  };
  for (const block of blocks) if (block.definesTargets) visit(block.node);
  return definitions;
};

const MAX_CACHED_DOCUMENTS = 128;
const documents = createHostContentCache<string, MarkdownDocument>(MAX_CACHED_DOCUMENTS);

/**
 * Returns the parse of `markdown` from a bounded module cache. `revision` names the text source,
 * such as a message ID or a message ID with its text revision. The next text of the same
 * revision parses from the cached document, and a remounted view gets its parse back without
 * parsing again. Without a revision, the cache key is a hash of the text.
 */
export const readMarkdownDocument = (
  markdown: string,
  revision: string | number | undefined,
  previous: MarkdownDocument | null,
): MarkdownDocument => {
  const key = revision === undefined ? `text:${contentHash(markdown)}` : `revision:${revision}`;
  const cached = documents.get(key);
  if (cached?.markdown === markdown) return cached;
  const document = parseMarkdownDocument(markdown, cached ?? previous);
  documents.set(key, document);
  return document;
};
