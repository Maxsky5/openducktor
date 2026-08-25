import { Editor, type JSONContent } from "@tiptap/core";
import { splitTaskDescriptionFrontMatter } from "./task-description-front-matter";
import {
  assessVisualMarkdownSyntaxCompatibility,
  canonicalRendererMathSemantics,
  canonicalRendererOrderedListSemantics,
  hasEquivalentCanonicalRendererSemantics,
  type MarkdownMathSemantic,
  type MarkdownOrderedListSemantic,
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

const nodeText = (node: JSONContent): string =>
  node.text ?? (node.content ?? []).map(nodeText).join("");

export const getTaskDescriptionVisualMermaidSources = (markdown: string): string[] => {
  const frontMatter = splitTaskDescriptionFrontMatter(markdown);
  if (frontMatter.kind === "malformed") {
    throw new Error("Malformed front matter cannot enter Visual mode.");
  }

  const sources: string[] = [];
  const collect = (node: JSONContent): void => {
    if (node.type === "codeBlock" && node.attrs?.language === "mermaid") {
      sources.push(nodeText(node));
    }
    node.content?.forEach(collect);
  };
  collect(parseBodyToJson(frontMatter.body));
  return sources;
};

const canonicalizeBody = (body: string): string => {
  const editor = createMarkdownEditor(body);
  try {
    return editor.getMarkdown();
  } finally {
    editor.destroy();
  }
};

type MarkdownJsonContent = JSONContent & {
  position?: unknown;
  spread?: unknown;
};

const semanticTree = ({
  position: _position,
  spread: _spread,
  content,
  ...node
}: MarkdownJsonContent): JSONContent => ({
  ...node,
  ...(content === undefined ? undefined : { content: content.map(semanticTree) }),
});

const visualEditorMathSemantics = (tree: JSONContent): MarkdownMathSemantic[] => {
  const semantics: MarkdownMathSemantic[] = [];

  const collect = (node: JSONContent): void => {
    if (node.type === "blockMath") {
      semantics.push({ kind: "block", value: String(node.attrs?.latex ?? "") });
    } else if (node.type === "inlineMath") {
      semantics.push({ kind: "inline", value: String(node.attrs?.latex ?? "") });
    }
    node.content?.forEach(collect);
  };

  collect(tree);
  return semantics;
};

const orderedListsInVisualTree = (node: JSONContent): MarkdownOrderedListSemantic[] => {
  if (node.type === "orderedList") {
    return [
      {
        start: Number(node.attrs?.start ?? 1),
        items: (node.content ?? []).map((item) => ({
          lists: (item.content ?? []).flatMap(orderedListsInVisualTree),
        })),
      },
    ];
  }
  return (node.content ?? []).flatMap(orderedListsInVisualTree);
};

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
    const visualMath = visualEditorMathSemantics(originalTree);
    const rendererMath = canonicalRendererMathSemantics(frontMatter.body);
    if (JSON.stringify(visualMath) !== JSON.stringify(rendererMath)) {
      return {
        compatible: false,
        reason:
          "Block math delimiters do not have the same meaning in Visual mode and the canonical renderer. Keep this source in Markdown mode and pair each standalone $$ delimiter.",
      };
    }
    const visualOrderedLists = orderedListsInVisualTree(originalTree);
    const rendererOrderedLists = canonicalRendererOrderedListSemantics(frontMatter.body);
    if (JSON.stringify(visualOrderedLists) !== JSON.stringify(rendererOrderedLists)) {
      return {
        compatible: false,
        reason:
          "Nested ordered lists that start with a number other than 1 need a blank line before the nested list to match the canonical renderer.",
      };
    }
    if (JSON.stringify(originalTree) !== JSON.stringify(canonicalTree)) {
      return {
        compatible: false,
        reason:
          "This Markdown cannot be preserved by Visual mode. Keep it in Markdown mode or simplify the source form.",
      };
    }
    if (!hasEquivalentCanonicalRendererSemantics(frontMatter.body, canonicalBody)) {
      return {
        compatible: false,
        reason:
          "This Markdown changes meaning in the canonical renderer after Visual editing. Keep it in Markdown mode or simplify the source form.",
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
