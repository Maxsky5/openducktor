import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { splitTaskDescriptionFrontMatter } from "./task-description-front-matter";

export type VisualMarkdownCompatibility =
  | { compatible: true }
  | { compatible: false; reason: string };

const SUPPORTED_MDAST_NODE_TYPES = new Set([
  "root",
  "text",
  "paragraph",
  "heading",
  "strong",
  "emphasis",
  "delete",
  "inlineCode",
  "code",
  "blockquote",
  "thematicBreak",
  "link",
  "image",
  "list",
  "listItem",
  "table",
  "tableRow",
  "tableCell",
  "inlineMath",
  "math",
  "break",
]);

const UNSUPPORTED_NODE_REASONS: Record<string, string> = {
  html: "Raw HTML is available only in Markdown mode because Visual mode would remove it.",
  definition:
    "Reference-style links and images are available only in Markdown mode. Change them to inline links to use Visual mode.",
  linkReference:
    "Reference-style links are available only in Markdown mode. Change them to inline links to use Visual mode.",
  imageReference:
    "Reference-style images are available only in Markdown mode. Change them to inline images to use Visual mode.",
};

const sourceForNode = (
  body: string,
  node: {
    position?:
      | { start: { offset?: number | undefined }; end: { offset?: number | undefined } }
      | undefined;
  },
): string => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? "" : body.slice(start, end);
};

const findUnsupportedSyntax = (body: string): string | undefined => {
  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(body);
  let reason: string | undefined;

  visit(tree, (node) => {
    if (reason !== undefined) {
      return;
    }

    reason = UNSUPPORTED_NODE_REASONS[node.type];
    if (reason !== undefined) {
      return;
    }
    if (!SUPPORTED_MDAST_NODE_TYPES.has(node.type)) {
      reason = `${node.type} Markdown is available only in Markdown mode because Visual mode cannot preserve it.`;
      return;
    }

    const source = sourceForNode(body, node);
    if (node.type === "text" && source.includes("$")) {
      reason =
        "Literal or escaped dollar text is available only in Markdown mode because Visual mode could interpret it as math.";
      return;
    }
    if (node.type === "inlineMath") {
      const mathSource = source.slice(1, -1);
      if (!mathSource || mathSource.trim() !== mathSource) {
        reason =
          "Dollar-delimited math cannot start or end with whitespace. Keep this text in Markdown mode or remove the extra spaces.";
      }
      return;
    }
    if (node.type === "tableCell" && source.includes("\\|")) {
      reason =
        "Table cells with an escaped pipe are available only in Markdown mode because Visual mode cannot preserve the escape.";
    }
  });

  return reason;
};

export const assessVisualMarkdownCompatibility = (
  markdown: string,
): VisualMarkdownCompatibility => {
  const frontMatter = splitTaskDescriptionFrontMatter(markdown);
  if (frontMatter.kind === "malformed") {
    return {
      compatible: false,
      reason: `Close the leading ${frontMatter.syntax} front matter with a ${frontMatter.closingDelimiter} line before using Visual mode.`,
    };
  }

  const unsupportedReason = findUnsupportedSyntax(frontMatter.body);
  return unsupportedReason === undefined
    ? { compatible: true }
    : { compatible: false, reason: unsupportedReason };
};
