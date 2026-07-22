import type {
  AnyExtension,
  JSONContent,
  MarkdownLexerConfiguration,
  MarkdownParseHelpers,
  MarkdownRendererHelpers,
  MarkdownToken,
  MarkdownTokenizer,
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
const defaultListItemRenderMarkdown = requireMarkdownHook(
  "ListItem",
  "renderMarkdown",
  ListItem.config.renderMarkdown,
);
const defaultOrderedListParseMarkdown = requireMarkdownHook(
  "OrderedList",
  "parseMarkdown",
  OrderedList.config.parseMarkdown,
);
const defaultOrderedListMarkdownTokenizer = OrderedList.config.markdownTokenizer;
if (!defaultOrderedListMarkdownTokenizer?.tokenize) {
  throw new Error(
    "TipTap 3.28.0 OrderedList.markdownTokenizer is required by the task-description Markdown dialect. Align all TipTap packages before starting the editor.",
  );
}
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

const ensureLeadingMathParagraph = (node: JSONContent): JSONContent => {
  if (node.type !== "listItem" || node.content?.[0]?.type !== "blockMath") {
    return node;
  }
  return {
    ...node,
    content: [{ type: "paragraph" }, ...(node.content ?? [])],
  };
};

const ensureOrderedListMathParagraphs = (
  parsed: JSONContent | JSONContent[],
): JSONContent | JSONContent[] => {
  const ensureNode = (node: JSONContent): JSONContent => {
    if (node.type !== "orderedList" || !node.content) {
      return node;
    }
    return {
      ...node,
      content: node.content.map(ensureLeadingMathParagraph),
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

const listItemSource = (token: MarkdownToken): string | undefined => {
  const lines = tokenSource(token).replaceAll("\r\n", "\n").split("\n");
  const opening = lines[0]?.match(/^([ \t]*(?:[-+*]|\d+[.)])[ \t]+)(.*)$/);
  if (!opening) {
    return undefined;
  }

  const continuationWidth = opening[1]?.length ?? 0;
  return [
    opening[2] ?? "",
    ...lines.slice(1).map((line) => {
      const leadingWhitespace = line.length - line.trimStart().length;
      return line.slice(Math.min(leadingWhitespace, continuationWidth));
    }),
  ].join("\n");
};

// TipTap 3.28 only block-lexes ordered item content after an initial paragraph.
// Re-lex each item's own source, then restore nested ordered lists that its tokenizer stores outside
// that source segment.
const reparseOrderedListItems = (
  token: MarkdownToken,
  lexer: MarkdownLexerConfiguration,
): MarkdownToken => {
  if (token.type !== "list" || !token.ordered || !Array.isArray(token.items)) {
    return token;
  }

  return {
    ...token,
    items: token.items.map((item: MarkdownToken) => {
      const source = listItemSource(item);
      if (source === undefined) {
        return item;
      }

      const nestedOrderedLists = (item.tokens ?? [])
        .filter((child) => child.type === "list" && child.ordered)
        .map((child) => reparseOrderedListItems(child, lexer));
      return {
        ...item,
        tokens: [...lexer.blockTokens(source), ...nestedOrderedLists],
      };
    }),
  };
};

const taskDescriptionOrderedListTokenizer: MarkdownTokenizer = {
  ...defaultOrderedListMarkdownTokenizer,
  tokenize(src, tokens, lexer) {
    const token = defaultOrderedListMarkdownTokenizer.tokenize(src, tokens, lexer);
    return token ? reparseOrderedListItems(token, lexer) : token;
  },
};

// TipTap leaves one list-indent space on prose after a second block-math token.
// Remove only that paragraph-start artifact before parsing the trailing tokens.
const trimParagraphTokenStart = (token: MarkdownToken): MarkdownToken => {
  if (token.type !== "paragraph") {
    return token;
  }

  const inlineTokens = Array.isArray(token.tokens) ? [...token.tokens] : undefined;
  if (inlineTokens?.[0]) {
    inlineTokens[0] = {
      ...inlineTokens[0],
      ...(inlineTokens[0].raw === undefined ? {} : { raw: inlineTokens[0].raw.trimStart() }),
      ...(inlineTokens[0].text === undefined ? {} : { text: inlineTokens[0].text.trimStart() }),
    };
  }
  return {
    ...token,
    ...(token.raw === undefined ? {} : { raw: token.raw.trimStart() }),
    ...(token.text === undefined ? {} : { text: token.text.trimStart() }),
    ...(inlineTokens === undefined ? {} : { tokens: inlineTokens }),
  };
};

const findTrailingTokens = (
  tokens: MarkdownToken[],
  trailingSource: string | undefined,
  tokenKind: string,
): MarkdownToken[] => {
  if (!trailingSource) {
    return [];
  }

  let suffix = "";
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    suffix = `${tokenSource(tokens[index] as MarkdownToken)}${suffix}`;
    if (suffix.trim() === trailingSource) {
      const trailingTokens = tokens.slice(index);
      const first = trailingTokens[0];
      return first ? [trimParagraphTokenStart(first), ...trailingTokens.slice(1)] : trailingTokens;
    }
  }

  throw new Error(
    `TipTap 3.28.0 ${tokenKind} tokens do not expose the trailing Markdown after block math. Align all TipTap packages before starting the editor.`,
  );
};

const withLeadingListItemMathTokens = (token: MarkdownToken): MarkdownToken => {
  const itemSource = listItemSource(token);
  if (itemSource === undefined) {
    return token;
  }
  const sequence = parseLeadingBlockMathSequence(itemSource);
  if (!sequence) {
    return token;
  }

  const trailingTokens = findTrailingTokens(
    Array.isArray(token.tokens) ? token.tokens : [],
    sequence.trailingSource,
    "list-item",
  );
  return {
    ...token,
    tokens: [
      ...sequence.values.map((latex) => ({
        type: "blockMath",
        raw: `$$\n${latex}\n$$`,
        latex,
        tokens: [],
      })),
      ...trailingTokens,
    ],
  };
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
    content.push(
      ...helpers.parseChildren(
        findTrailingTokens(token.nestedTokens, sequence.trailingSource, "task-item"),
      ),
    );
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
    const nestedList =
      child.type === "bulletList" || child.type === "orderedList" || child.type === "taskList";
    const separator = nestedList ? "\n" : "\n\n";
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
    const parsed = defaultListItemParseMarkdown(withLeadingListItemMathTokens(token), helpers);
    return Array.isArray(parsed)
      ? parsed.map(ensureLeadingMathParagraph)
      : ensureLeadingMathParagraph(parsed);
  },

  renderMarkdown(node, helpers, context) {
    const content = node.content ?? [];
    const needsDialectRenderer =
      context.parentType === "orderedList" ||
      content.some((child) => child.type === "blockMath" || child.type === "codeBlock");
    return needsDialectRenderer
      ? renderListItem(node, helpers, listItemPrefix(context))
      : defaultListItemRenderMarkdown(node, helpers, context);
  },
});

export const TaskDescriptionOrderedList = OrderedList.extend({
  markdownTokenizer: taskDescriptionOrderedListTokenizer,

  parseMarkdown(token, helpers) {
    return ensureOrderedListMathParagraphs(defaultOrderedListParseMarkdown(token, helpers));
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
