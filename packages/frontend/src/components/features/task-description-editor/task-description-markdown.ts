import { Editor, type JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { Mathematics } from "@tiptap/extension-mathematics";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { splitTaskDescriptionFrontMatter } from "./task-description-front-matter";

export {
  splitTaskDescriptionFrontMatter,
  type TaskDescriptionFrontMatter,
} from "./task-description-front-matter";

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

const createMarkdownEditor = (body: string): Editor =>
  new Editor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      Image.configure({ allowBase64: false }),
      Mathematics,
      Markdown.configure({ markedOptions: { gfm: true } }),
    ],
    content: body,
    contentType: "markdown",
  });

const normalizeJson = (value: JSONContent): JSONContent =>
  JSON.parse(JSON.stringify(value)) as JSONContent;

const parseBodyToJson = (body: string): JSONContent => {
  const editor = createMarkdownEditor(body);
  try {
    return normalizeJson(editor.getJSON());
  } finally {
    editor.destroy();
  }
};

const canonicalizeBody = (body: string): string => {
  const editor = createMarkdownEditor(body);
  try {
    return editor.getMarkdown();
  } finally {
    editor.destroy();
  }
};

const findUnsupportedSyntax = (body: string): string | undefined => {
  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(body);
  let reason: string | undefined;

  visit(tree, (node) => {
    if (reason !== undefined) {
      return;
    }
    reason = UNSUPPORTED_NODE_REASONS[node.type];
    if (reason === undefined && !SUPPORTED_MDAST_NODE_TYPES.has(node.type)) {
      reason = `${node.type} Markdown is available only in Markdown mode because Visual mode cannot preserve it.`;
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
  if (unsupportedReason !== undefined) {
    return { compatible: false, reason: unsupportedReason };
  }

  try {
    const originalTree = parseBodyToJson(frontMatter.body);
    const canonicalBody = canonicalizeBody(frontMatter.body);
    const canonicalTree = parseBodyToJson(canonicalBody);
    if (JSON.stringify(originalTree) !== JSON.stringify(canonicalTree)) {
      return {
        compatible: false,
        reason:
          "This Markdown cannot be preserved by Visual mode. Keep editing it in Markdown mode.",
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      compatible: false,
      reason: `Visual mode could not parse this Markdown: ${message}`,
    };
  }

  return { compatible: true };
};

export const canonicalizeTaskDescriptionMarkdown = (markdown: string): string => {
  const compatibility = assessVisualMarkdownCompatibility(markdown);
  if (!compatibility.compatible) {
    throw new Error(compatibility.reason);
  }

  const frontMatter = splitTaskDescriptionFrontMatter(markdown);
  if (frontMatter.kind === "malformed") {
    throw new Error("Malformed front matter cannot be canonicalized.");
  }

  return `${frontMatter.raw}${canonicalizeBody(frontMatter.body)}`;
};
