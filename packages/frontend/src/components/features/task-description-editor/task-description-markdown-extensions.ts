import type {
  AnyExtension,
  JSONContent,
  MarkdownParseHelpers,
  MarkdownRendererHelpers,
  MarkdownToken,
  RenderContext,
} from "@tiptap/core";
import { CodeBlock } from "@tiptap/extension-code-block";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { getListMarker, ListItem, OrderedList } from "@tiptap/extension-list";
import { Mathematics } from "@tiptap/extension-mathematics";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

const defaultListItemParseMarkdown = ListItem.config.parseMarkdown;
const defaultListItemRenderMarkdown = ListItem.config.renderMarkdown;
const defaultOrderedListParseMarkdown = OrderedList.config.parseMarkdown;
const defaultTaskItemParseMarkdown = TaskItem.config.parseMarkdown;
const defaultTaskItemRenderMarkdown = TaskItem.config.renderMarkdown;

export const TaskDescriptionImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: { default: null },
    };
  },
});

const trimTrailingBlankLines = (lines: string[]): string[] => {
  let end = lines.length;
  while (end > 0 && lines[end - 1]?.trim() === "") {
    end -= 1;
  }
  return lines.slice(0, end);
};

const extractListItemBlockMath = (token: MarkdownToken): string | undefined => {
  const lines = trimTrailingBlankLines((token.raw ?? "").replaceAll("\r\n", "\n").split("\n"));
  const opening = lines[0]?.match(/^([ \t]*(?:[-+*]|\d+[.)])[ \t]+)\$\$[ \t]*$/);
  const closing = lines.at(-1);
  if (!opening || closing?.trim() !== "$$" || lines.length < 3) {
    return undefined;
  }

  const indentWidth = opening[1]?.length ?? 0;
  const body: string[] = [];
  for (const line of lines.slice(1, -1)) {
    const indent = line.slice(0, indentWidth);
    if (line && indent.trim() !== "") {
      return undefined;
    }
    body.push(line.slice(indentWidth));
  }
  return body.join("\n");
};

const extractTaskItemBlockMath = (token: MarkdownToken): string | undefined => {
  if (token.mainContent?.trim() !== "$$" || !Array.isArray(token.nestedTokens)) {
    return undefined;
  }

  const nestedSource = token.nestedTokens
    .map((nestedToken: MarkdownToken) => nestedToken.raw ?? nestedToken.text ?? "")
    .join("")
    .replaceAll("\r\n", "\n");
  const lines = trimTrailingBlankLines(nestedSource.split("\n"));
  if (lines.at(-1)?.trim() !== "$$" || lines.length < 2) {
    return undefined;
  }
  return lines.slice(0, -1).join("\n");
};

const createListBlockMathNode = (
  type: "listItem" | "taskItem",
  latex: string,
  helpers: MarkdownParseHelpers,
  attrs: Record<string, unknown> = {},
): JSONContent =>
  helpers.createNode(type, attrs, [
    helpers.createNode("paragraph", {}, []),
    helpers.createNode("blockMath", { latex }),
  ]);

const isEmptyParagraph = (node: JSONContent | undefined): boolean =>
  node?.type === "paragraph" && (!node.content || node.content.length === 0);

const leadingBlockMathIndex = (content: JSONContent[]): number => {
  if (content[0]?.type === "blockMath") {
    return 0;
  }
  return isEmptyParagraph(content[0]) && content[1]?.type === "blockMath" ? 1 : -1;
};

const renderPrefixedBlockMath = (
  node: JSONContent,
  helpers: MarkdownRendererHelpers,
  prefix: string,
  continuationWidth = prefix.length,
): string | undefined => {
  const content = node.content ?? [];
  const mathIndex = leadingBlockMathIndex(content);
  if (mathIndex < 0) {
    return undefined;
  }

  const math = content[mathIndex];
  if (!math) {
    return undefined;
  }
  const renderedMath = helpers.renderChild?.(math, mathIndex) ?? helpers.renderChildren([math]);
  const continuation = " ".repeat(continuationWidth);
  let output = renderedMath
    .split("\n")
    .map((line, index) => `${index === 0 ? prefix : continuation}${line}`)
    .join("\n");

  for (const [index, child] of content.entries()) {
    if (index <= mathIndex) {
      continue;
    }
    const renderedChild = helpers.renderChild?.(child, index) ?? helpers.renderChildren([child]);
    const separator = child.type === "paragraph" ? "\n\n" : "\n";
    output += `${separator}${renderedChild
      .split("\n")
      .map((line) => `${continuation}${line}`)
      .join("\n")}`;
  }
  return output;
};

const listItemPrefix = (context: RenderContext): string => {
  if (context.parentType !== "orderedList") {
    return "- ";
  }
  const start = Number(context.meta?.parentAttrs?.start ?? 1);
  const type = context.meta?.parentAttrs?.type as string | undefined;
  return getListMarker(type, start - 1 + context.index, ". ");
};

export const TaskDescriptionListItem = ListItem.extend({
  parseMarkdown(token, helpers) {
    const latex = extractListItemBlockMath(token);
    return latex === undefined
      ? (defaultListItemParseMarkdown?.(token, helpers) ?? [])
      : createListBlockMathNode("listItem", latex, helpers);
  },

  renderMarkdown(node, helpers, context) {
    return (
      renderPrefixedBlockMath(node, helpers, listItemPrefix(context)) ??
      defaultListItemRenderMarkdown?.(node, helpers, context) ??
      ""
    );
  },
});

export const TaskDescriptionOrderedList = OrderedList.extend({
  parseMarkdown(token, helpers) {
    if (token.type !== "list" || !token.ordered || !Array.isArray(token.items)) {
      return defaultOrderedListParseMarkdown?.(token, helpers) ?? [];
    }

    const items = token.items.map((item: MarkdownToken) => {
      const latex = extractListItemBlockMath(item);
      return latex === undefined
        ? item
        : {
            ...item,
            tokens: [
              {
                type: "blockMath",
                raw: `$$\n${latex}\n$$`,
                latex,
              },
            ],
          };
    });
    return defaultOrderedListParseMarkdown?.({ ...token, items }, helpers) ?? [];
  },
});

export const TaskDescriptionTaskItem = TaskItem.extend({
  parseMarkdown(token, helpers) {
    const latex = extractTaskItemBlockMath(token);
    return latex === undefined
      ? (defaultTaskItemParseMarkdown?.(token, helpers) ?? [])
      : createListBlockMathNode("taskItem", latex, helpers, {
          checked: Boolean(token.checked),
        });
  },

  renderMarkdown(node, helpers, context) {
    const prefix = `- [${node.attrs?.checked ? "x" : " "}] `;
    return (
      renderPrefixedBlockMath(node, helpers, prefix, 2) ??
      defaultTaskItemRenderMarkdown?.(node, helpers, context) ??
      ""
    );
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
    StarterKit.configure({ codeBlock: false, link: false, listItem: false, orderedList: false }),
    Link.configure({ openOnClick: false }),
    codeBlock,
    TaskList,
    TaskDescriptionOrderedList,
    TaskDescriptionListItem,
    TaskDescriptionTaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    image.configure({ allowBase64: false }),
    mathematics,
    Markdown.configure({ markedOptions: { gfm: true } }),
  ];
}
