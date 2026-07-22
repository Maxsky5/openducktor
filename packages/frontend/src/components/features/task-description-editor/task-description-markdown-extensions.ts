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

const requireMarkdownHook = <Hook>(
  extensionName: string,
  hookName: string,
  hook: Hook | undefined,
): NonNullable<Hook> => {
  if (typeof hook !== "function") {
    throw new Error(
      `TipTap 3.28.0 ${extensionName}.${hookName} is required by the task-description Markdown dialect. Align all TipTap packages before starting the editor.`,
    );
  }
  return hook as NonNullable<Hook>;
};

const defaultListItemParseMarkdown = requireMarkdownHook(
  "ListItem",
  "parseMarkdown",
  ListItem.config.parseMarkdown,
);
const defaultOrderedListParseMarkdown = requireMarkdownHook(
  "OrderedList",
  "parseMarkdown",
  OrderedList.config.parseMarkdown,
);
const defaultTaskItemParseMarkdown = requireMarkdownHook(
  "TaskItem",
  "parseMarkdown",
  TaskItem.config.parseMarkdown,
);

export const TaskDescriptionImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: { default: null },
    };
  },
});

const isEmptyParagraph = (node: JSONContent | undefined): boolean =>
  node?.type === "paragraph" && (!node.content || node.content.length === 0);

const ensureListItemParagraph = (node: JSONContent): JSONContent => {
  if (node.type !== "listItem" || node.content?.[0]?.type === "paragraph") {
    return node;
  }
  return {
    ...node,
    content: [{ type: "paragraph" }, ...(node.content ?? [])],
  };
};

const ensureOrderedListParagraphs = (
  parsed: JSONContent | JSONContent[],
): JSONContent | JSONContent[] => {
  const ensureNode = (node: JSONContent): JSONContent => {
    if (node.type !== "orderedList") {
      return node;
    }
    if (!node.content) {
      return node;
    }
    return {
      ...node,
      content: node.content.map(ensureListItemParagraph),
    };
  };
  return Array.isArray(parsed) ? parsed.map(ensureNode) : ensureNode(parsed);
};

type BlockMathSequence = {
  values: string[];
  trailingSource?: string;
};

const parseLeadingBlockMathSequence = (source: string): BlockMathSequence | undefined => {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const values: string[] = [];
  let index = 0;

  while (lines[index]?.trim() === "$$") {
    index += 1;
    const body: string[] = [];
    while (index < lines.length && lines[index]?.trim() !== "$$") {
      body.push(lines[index] ?? "");
      index += 1;
    }
    if (lines[index]?.trim() !== "$$") {
      return undefined;
    }
    values.push(body.join("\n"));
    index += 1;
    while (lines[index]?.trim() === "") {
      index += 1;
    }
  }

  if (values.length === 0) {
    return undefined;
  }
  const trailingSource = lines.slice(index).join("\n").trim();
  return trailingSource ? { values, trailingSource } : { values };
};

const tokenSource = (token: MarkdownToken): string => token.raw ?? token.text ?? "";

const extractSoleLeadingListMath = (token: MarkdownToken): string | undefined => {
  const lines = tokenSource(token).replaceAll("\r\n", "\n").split("\n");
  const opening = lines[0]?.match(/^([ \t]*(?:[-+*]|\d+[.)])[ \t]+)\$\$[ \t]*$/);
  if (!opening || lines.at(-1)?.trim() !== "$$" || lines.length < 3) {
    return undefined;
  }
  const bodyLines = lines.slice(1, -1);
  if (bodyLines.some((line) => line.trim() === "$$")) {
    return undefined;
  }

  const continuationWidth = opening[1]?.length ?? 0;
  return bodyLines.map((line) => line.slice(continuationWidth)).join("\n");
};

const parseLeadingTaskItemMath = (
  token: MarkdownToken,
  helpers: MarkdownParseHelpers,
): JSONContent | undefined => {
  if (token.mainContent?.trim() !== "$$" || !Array.isArray(token.nestedTokens)) {
    return undefined;
  }

  const nestedSource = token.nestedTokens.map(tokenSource).join("");
  const sequence = parseLeadingBlockMathSequence(`$$\n${nestedSource}`);
  if (!sequence) {
    return undefined;
  }

  const content = [
    helpers.createNode("paragraph", {}, []),
    ...sequence.values.map((latex) => helpers.createNode("blockMath", { latex })),
  ];
  if (sequence.trailingSource) {
    let trailingStart = -1;
    let suffix = "";
    for (let index = token.nestedTokens.length - 1; index >= 0; index -= 1) {
      suffix = `${tokenSource(token.nestedTokens[index] as MarkdownToken)}${suffix}`;
      if (suffix.trim() === sequence.trailingSource) {
        trailingStart = index;
        break;
      }
    }
    if (trailingStart < 0) {
      throw new Error(
        "TipTap 3.28.0 task-item tokens do not expose the trailing Markdown after block math. Align all TipTap packages before starting the editor.",
      );
    }
    content.push(...helpers.parseChildren(token.nestedTokens.slice(trailingStart)));
  }

  return helpers.createNode("taskItem", { checked: Boolean(token.checked) }, content);
};

const renderListItem = (
  node: JSONContent,
  helpers: MarkdownRendererHelpers,
  prefix: string,
  continuationWidth = prefix.length,
): string => {
  const content = node.content ?? [];
  const startsWithMath = isEmptyParagraph(content[0]) && content[1]?.type === "blockMath";
  const firstIndex = startsWithMath ? 1 : 0;
  const first = content[firstIndex];
  const renderedFirst = first ? helpers.renderChildren([first]) : "";
  const continuation = " ".repeat(continuationWidth);
  let output = renderedFirst
    .split("\n")
    .map((line, index) => `${index === 0 ? prefix : continuation}${line}`)
    .join("\n");

  for (const [index, child] of content.entries()) {
    if (index <= firstIndex) {
      continue;
    }
    const renderedChild = helpers.renderChildren([child]);
    const separator = child.type === "paragraph" || child.type === "blockMath" ? "\n\n" : "\n";
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
    const parsed = defaultListItemParseMarkdown(token, helpers);
    return Array.isArray(parsed)
      ? parsed.map(ensureListItemParagraph)
      : ensureListItemParagraph(parsed);
  },

  renderMarkdown(node, helpers, context) {
    return renderListItem(node, helpers, listItemPrefix(context));
  },
});

export const TaskDescriptionOrderedList = OrderedList.extend({
  parseMarkdown(token, helpers) {
    const items = token.items?.map((item: MarkdownToken) => {
      const latex = extractSoleLeadingListMath(item);
      return latex === undefined
        ? item
        : {
            ...item,
            tokens: [{ type: "blockMath", raw: `$$\n${latex}\n$$`, latex }],
          };
    });
    return ensureOrderedListParagraphs(
      defaultOrderedListParseMarkdown(items ? { ...token, items } : token, helpers),
    );
  },
});

export const TaskDescriptionTaskItem = TaskItem.extend({
  parseMarkdown(token, helpers) {
    return parseLeadingTaskItemMath(token, helpers) ?? defaultTaskItemParseMarkdown(token, helpers);
  },

  renderMarkdown(node, helpers) {
    const prefix = `- [${node.attrs?.checked ? "x" : " "}] `;
    return renderListItem(node, helpers, prefix, 2);
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
