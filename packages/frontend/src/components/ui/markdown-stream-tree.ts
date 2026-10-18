/**
 * Renders one block of parsed Markdown. The block renders from its parsed nodes with the steps
 * that react-markdown runs after its parse, so the text does not parse again.
 */
import type { Root as HastRoot, RootContent as HastRootContent } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import type { Paragraph } from "mdast";
import { toHast } from "mdast-util-to-hast";
import type { ReactElement } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import type { Components, UrlTransform } from "react-markdown";
import { visit } from "unist-util-visit";
import type { MarkdownBlockContent } from "./markdown-stream-content";

/** Renders a block. `transformTree` changes the HTML tree in place first, for example to draw math. */
export const renderMarkdownBlock = (
  content: MarkdownBlockContent,
  components: Components,
  urlTransform: UrlTransform,
  transformTree?: (tree: HastRoot) => void,
): ReactElement => {
  const tree = markdownBlockTree(content);
  transformTree?.(tree);
  // Markdown makes links and images, but no raw HTML here, so `href` and `src` are its only URL
  // attributes.
  visit(tree, "element", (node) => {
    const attribute = urlAttribute(node.tagName);
    if (attribute !== null && attribute in node.properties) {
      // A transform without a URL drops the attribute, as in react-markdown.
      node.properties[attribute] =
        urlTransform(String(node.properties[attribute] || ""), attribute, node) ?? undefined;
    }
  });
  return toJsxRuntime(tree, {
    Fragment,
    components,
    ignoreInvalidStyle: true,
    jsx,
    jsxs,
    passKeys: true,
    passNode: true,
  });
};

/**
 * Gives the HTML tree of a block from its parsed nodes.
 * - The link definitions come first, so the first definition of an identifier wins.
 * - A hidden paragraph replays the earlier footnote references, so the footnote numbers and the
 *   backreference ids continue the text before the block.
 * - The tree drops the replay and the footnote list, or for the footnote list block, keeps only
 *   the list.
 */
const markdownBlockTree = (content: MarkdownBlockContent): HastRoot => {
  const tree = toHast({
    type: "root",
    // The conversion can share node data with the tree, so convert a copy.
    children: structuredClone([
      ...content.definitions,
      ...footnoteReplay(content.previousFootnoteIds),
      ...content.nodes,
    ]),
  });
  if (tree.type !== "root") {
    throw new Error(`mdast-util-to-hast returned a "${tree.type}" node for a root.`);
  }
  const isVisible =
    content.part === "footnotes"
      ? isFootnoteList
      : (node: HastRootContent) => !isFootnoteList(node) && !isFootnoteReplay(node);
  tree.children = tree.children.filter(isVisible);
  return tree;
};

const FOOTNOTE_REPLAY_PROPERTY = "dataOdtFootnoteReplay";

const footnoteReplay = (identifiers: readonly string[]): Paragraph[] =>
  identifiers.length === 0
    ? []
    : [
        {
          type: "paragraph",
          data: { hProperties: { [FOOTNOTE_REPLAY_PROPERTY]: true } },
          children: identifiers.map((identifier) => ({
            type: "footnoteReference",
            identifier,
            label: identifier,
          })),
        },
      ];

const isFootnoteList = (node: HastRootContent): boolean =>
  node.type === "element" && node.tagName === "section" && node.properties.dataFootnotes === true;

const isFootnoteReplay = (node: HastRootContent): boolean =>
  node.type === "element" && node.properties[FOOTNOTE_REPLAY_PROPERTY] === true;

const urlAttribute = (tagName: string): "href" | "src" | null => {
  switch (tagName) {
    case "a":
      return "href";
    case "img":
      return "src";
    default:
      return null;
  }
};
