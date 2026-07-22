import type { AnyExtension } from "@tiptap/core";
import { CodeBlock } from "@tiptap/extension-code-block";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Mathematics } from "@tiptap/extension-mathematics";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

export const TaskDescriptionImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: { default: null },
    };
  },
});

export function createTaskDescriptionMarkdownExtensions({
  codeBlock = CodeBlock,
  image = TaskDescriptionImage,
  mathematics = Mathematics,
}: {
  codeBlock?: AnyExtension;
  image?: AnyExtension;
  mathematics?: AnyExtension;
} = {}): AnyExtension[] {
  return [
    StarterKit.configure({ codeBlock: false, link: false }),
    Link.configure({ openOnClick: false }),
    codeBlock,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    image.configure({ allowBase64: false }),
    mathematics,
    Markdown.configure({ markedOptions: { gfm: true } }),
  ];
}
