/**
 * Gives each block of parsed Markdown the content that it renders. A block renders on its own,
 * so its content also holds the parts of the whole text that the block uses: link definitions and
 * the footnote references before it. The footnote list of the whole text is one more block.
 */
import type { Definition, FootnoteDefinition, RootContent } from "mdast";
import {
  type ParsedBlock,
  type ParsedDefinition,
  type ParsedMarkdown,
  parseMarkdown,
} from "./markdown-stream-parse";

export type MarkdownBlockContent = {
  /** Parsed nodes of the block, or the footnote definitions of the footnote list. */
  nodes: readonly RootContent[];
  /** Parsed link definitions that the nodes use, in text order. */
  definitions: readonly Definition[];
  /** Footnote references before the block, in text order. They continue the footnote numbers. */
  previousFootnoteIds: readonly string[];
  part: "content" | "footnotes";
  /** True when the block shows math, which needs KaTeX. */
  hasMath: boolean;
};

/** A block content, and the key of its input. Blocks with the same key share the content. */
export type KeyedContent = { inputKey: string; content: MarkdownBlockContent };

/** A top-level block: its content, and the facts of its parse that its content does not hold. */
export type DescribedBlock = KeyedContent & Pick<ParsedBlock, "start" | "openFenceCode">;

export type DescribedMarkdown = {
  markdown: string;
  parsed: ParsedMarkdown;
  blocks: readonly DescribedBlock[];
  /** Content of the footnote list, when the text has footnote references. */
  footnotes: KeyedContent | null;
};

/**
 * Parses streamed Markdown and describes its blocks. Unchanged blocks keep the content objects of
 * `previous`, so they do not render again.
 */
export const describeMarkdown = (
  markdown: string,
  previous: DescribedMarkdown | null,
): DescribedMarkdown => {
  const parsed = parseMarkdown(markdown, previous?.parsed ?? null);
  return { markdown, parsed, ...describeBlocks(parsed, previous) };
};

/** Describes complete Markdown once for each text, so a remount does not parse it again. */
export const describeCompleteMarkdown = (markdown: string): DescribedMarkdown => {
  const cached = describedTexts.get(markdown);
  if (cached) {
    describedTexts.delete(markdown);
    describedTexts.set(markdown, cached);
    return cached;
  }
  const described = describeMarkdown(markdown, null);
  if (markdown.length <= MAX_CACHED_MARKDOWN_LENGTH) {
    describedTexts.set(markdown, described);
    const oldestKey = describedTexts.keys().next().value;
    if (describedTexts.size > MAX_CACHED_MARKDOWN_TEXTS && oldestKey !== undefined) {
      describedTexts.delete(oldestKey);
    }
  }
  return described;
};

const MAX_CACHED_MARKDOWN_TEXTS = 200;
const MAX_CACHED_MARKDOWN_LENGTH = 50_000;
const describedTexts = new Map<string, DescribedMarkdown>();

type ParsedLinkDefinition = ParsedDefinition & { node: Definition };
type ParsedFootnoteDefinition = ParsedDefinition & { node: FootnoteDefinition };

const isLinkDefinition = (definition: ParsedDefinition): definition is ParsedLinkDefinition =>
  definition.node.type === "definition";

const isFootnoteDefinition = (
  definition: ParsedDefinition,
): definition is ParsedFootnoteDefinition => definition.node.type === "footnoteDefinition";

const describeBlocks = (
  parsed: ParsedMarkdown,
  previous: DescribedMarkdown | null,
): Pick<DescribedMarkdown, "blocks" | "footnotes"> => {
  const previousContents = new Map<string, MarkdownBlockContent>();
  for (const keyed of [...(previous?.blocks ?? []), previous?.footnotes ?? null]) {
    if (keyed) {
      previousContents.set(keyed.inputKey, keyed.content);
    }
  }
  // The key holds every input of the content, so a block with the same key renders the same.
  const keepContent = (
    input: { position: number; text: string; references: readonly string[] },
    content: Omit<MarkdownBlockContent, "definitions">,
    definitions: readonly ParsedLinkDefinition[],
  ): KeyedContent => {
    const inputKey = JSON.stringify([
      content.part,
      // Blocks with the same text at other positions keep their own content objects.
      input.position,
      input.text,
      // The same text parses with other references when the definitions of the text change.
      input.references,
      definitions.map(({ source }) => source),
      content.previousFootnoteIds,
    ]);
    const keptContent = previousContents.get(inputKey) ?? {
      ...content,
      definitions: definitions.map(({ node }) => node),
    };
    return { inputKey, content: keptContent };
  };

  const linkDefinitions = parsed.definitions.filter(isLinkDefinition);
  const footnoteIds: string[] = [];
  const blocks = parsed.blocks.map((block, position): DescribedBlock => {
    const previousFootnoteIds = [...footnoteIds];
    footnoteIds.push(...block.footnoteIds);
    const linkIds = new Set(block.linkIds);
    const keyed = keepContent(
      { position, text: block.text, references: [...block.linkIds, ...block.footnoteIds] },
      {
        nodes: [block.node],
        previousFootnoteIds: block.footnoteIds.length === 0 ? [] : previousFootnoteIds,
        part: "content",
        hasMath: block.hasMath,
      },
      linkDefinitions.filter(({ node }) => linkIds.has(node.identifier)),
    );
    return { ...keyed, start: block.start, openFenceCode: block.openFenceCode };
  });
  if (footnoteIds.length === 0) {
    return { blocks, footnotes: null };
  }

  const footnoteDefinitions = parsed.definitions.filter(isFootnoteDefinition);
  const footnotes = keepContent(
    {
      position: 0,
      text: footnoteDefinitions.map(({ source }) => source).join("\n\n"),
      references: [],
    },
    {
      nodes: footnoteDefinitions.map(({ node }) => node),
      previousFootnoteIds: footnoteIds,
      part: "footnotes",
      hasMath: footnoteDefinitions.some(({ hasMath }) => hasMath),
    },
    // Footnote definitions can refer to any link definition.
    linkDefinitions,
  );
  return { blocks, footnotes };
};
