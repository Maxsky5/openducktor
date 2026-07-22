import type { ListItem, Paragraph, Root, Text } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

const TASK_LIST_BLOCK_MATH =
  /^[ \t]*[-+*][ \t]+\[[ xX]\][ \t]+\$\$[ \t]*\r?\n[\s\S]*\r?\n[ \t]*\$\$[ \t]*$/;

const sourceForNode = (markdown: string, node: ListItem): string => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? "" : markdown.slice(start, end);
};

const createBlockMathNode = (
  value: string,
  position: ListItem["position"],
): ListItem["children"][number] =>
  ({
    type: "math",
    value,
    data: {
      hName: "pre",
      hChildren: [
        {
          type: "element",
          tagName: "code",
          properties: { className: ["language-math", "math-display"] },
          children: [{ type: "text", value }],
        },
      ],
    },
    ...(position ? { position } : {}),
  }) as unknown as ListItem["children"][number];

export const normalizeTaskListBlockMath = (tree: Root, markdown: string): void => {
  visit(tree, "listItem", (node: ListItem) => {
    if (node.checked === null || node.checked === undefined || node.children?.length !== 2) {
      return;
    }

    const [opening, closing] = node.children;
    const openingText = (opening as Paragraph | undefined)?.children;
    if (
      opening?.type !== "paragraph" ||
      openingText?.length !== 1 ||
      openingText[0]?.type !== "text" ||
      closing?.type !== "math" ||
      !("value" in closing) ||
      closing.value !== "" ||
      !TASK_LIST_BLOCK_MATH.test(sourceForNode(markdown, node))
    ) {
      return;
    }

    const text = (openingText[0] as Text).value;
    const value = text.match(/^\$\$\r?\n([\s\S]+)$/)?.[1];
    if (value === undefined) {
      return;
    }

    node.children = [createBlockMathNode(value, node.position)];
  });
};

export const remarkTaskListBlockMath: Plugin<[], Root> =
  () =>
  (tree, file): void => {
    normalizeTaskListBlockMath(tree, String(file));
  };
