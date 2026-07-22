import { Editor, type JSONContent } from "@tiptap/core";
import { splitTaskDescriptionFrontMatter } from "./task-description-front-matter";
import {
  assessVisualMarkdownSyntaxCompatibility,
  type VisualMarkdownCompatibility,
} from "./task-description-markdown-compatibility";
import { createTaskDescriptionMarkdownExtensions } from "./task-description-markdown-extensions";

export {
  splitTaskDescriptionFrontMatter,
  type TaskDescriptionFrontMatter,
} from "./task-description-front-matter";

const createMarkdownEditor = (body: string): Editor =>
  new Editor({
    extensions: createTaskDescriptionMarkdownExtensions(),
    content: body,
    contentType: "markdown",
  });

const normalizeJson = (value: JSONContent): JSONContent => structuredClone(value);

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

const semanticTree = (value: JSONContent): JSONContent =>
  JSON.parse(
    JSON.stringify(value, (key, nestedValue) => {
      if (key === "position" || key === "spread") {
        return undefined;
      }
      return nestedValue;
    }),
  ) as JSONContent;

export const assessVisualMarkdownCompatibility = (
  markdown: string,
): VisualMarkdownCompatibility => {
  const syntaxCompatibility = assessVisualMarkdownSyntaxCompatibility(markdown);
  if (!syntaxCompatibility.compatible) {
    return syntaxCompatibility;
  }

  const frontMatter = splitTaskDescriptionFrontMatter(markdown);
  if (frontMatter.kind === "malformed") {
    return {
      compatible: false,
      reason: "Malformed front matter cannot enter Visual mode.",
    };
  }

  try {
    const canonicalBody = canonicalizeBody(frontMatter.body);
    const originalTree = semanticTree(parseBodyToJson(frontMatter.body));
    const canonicalTree = semanticTree(parseBodyToJson(canonicalBody));
    if (JSON.stringify(originalTree) !== JSON.stringify(canonicalTree)) {
      return {
        compatible: false,
        reason:
          "This Markdown cannot be preserved by Visual mode. Keep it in Markdown mode or simplify the source form.",
      };
    }
  } catch {
    return {
      compatible: false,
      reason:
        "This Markdown cannot be parsed safely by Visual mode. Keep it in Markdown mode or fix the source.",
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
