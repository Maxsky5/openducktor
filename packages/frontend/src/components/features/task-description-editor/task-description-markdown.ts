import { Editor, type JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { Mathematics } from "@tiptap/extension-mathematics";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { splitTaskDescriptionFrontMatter } from "./task-description-front-matter";
import { assessVisualMarkdownCompatibility } from "./task-description-markdown-compatibility";

export {
  splitTaskDescriptionFrontMatter,
  type TaskDescriptionFrontMatter,
} from "./task-description-front-matter";
export { assessVisualMarkdownCompatibility } from "./task-description-markdown-compatibility";

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

export const canonicalizeTaskDescriptionMarkdown = (markdown: string): string => {
  const compatibility = assessVisualMarkdownCompatibility(markdown);
  if (!compatibility.compatible) {
    throw new Error(compatibility.reason);
  }

  const frontMatter = splitTaskDescriptionFrontMatter(markdown);
  if (frontMatter.kind === "malformed") {
    throw new Error("Malformed front matter cannot be canonicalized.");
  }

  const canonicalBody = canonicalizeBody(frontMatter.body);
  const originalTree = parseBodyToJson(frontMatter.body);
  const canonicalTree = parseBodyToJson(canonicalBody);
  if (JSON.stringify(originalTree) !== JSON.stringify(canonicalTree)) {
    throw new Error("This Markdown cannot be preserved by Visual mode.");
  }

  return `${frontMatter.raw}${canonicalBody}`;
};
