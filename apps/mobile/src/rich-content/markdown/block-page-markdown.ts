/**
 * The Markdown that a block page renders for one block. The page parses the block alone, so the
 * text adds the definitions of the link and image references that other blocks define. Without
 * them, such a reference shows as text in brackets.
 */
import type { Nodes } from "mdast";
import { MAX_BLOCK_MARKDOWN_LENGTH } from "../isolated-page/block-page-messages";
import type { MarkdownDefinition, MarkdownDefinitions } from "./markdown-document";

/** The block text with the definitions that it references, or null when a page cannot render it. */
export const blockPageMarkdown = (
  source: string,
  node: Nodes,
  definitions: MarkdownDefinitions,
): string | null => {
  const lines: string[] = [];
  const added = new Set<string>();
  const visit = (current: Nodes): void => {
    if (current.type === "linkReference" || current.type === "imageReference") {
      const definition = definitions.get(current.identifier);
      if (definition !== undefined && !added.has(current.identifier)) {
        added.add(current.identifier);
        lines.push(definitionLine(current.label ?? current.identifier, definition));
      }
    }
    if ("children" in current) for (const child of current.children) visit(child);
  };
  visit(node);
  // A blank line ends the block, so each definition line starts on its own.
  const markdown = lines.length === 0 ? source : `${source}\n\n${lines.join("\n")}`;
  return markdown.length > MAX_BLOCK_MARKDOWN_LENGTH ? null : markdown;
};

// A backslash keeps each of these characters literal in a destination or a title.
const escapeDestination = (url: string): string => url.replace(/[\\<>&]/g, "\\$&");
const escapeTitle = (title: string): string => title.replace(/[\\"&]/g, "\\$&");

const definitionLine = (label: string, { url, title }: MarkdownDefinition): string =>
  `[${label}]: <${escapeDestination(url)}>${title === null ? "" : ` "${escapeTitle(title)}"`}`;
