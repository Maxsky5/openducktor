import type { ListItem, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import type { Plugin } from "unified";
import { unified } from "unified";
import { visit } from "unist-util-visit";

const TASK_ITEM_PREFIX = /^([ \t]*[-+*][ \t]+\[[ xX]\][ \t]+)(.*)$/;

const sourceForNode = (markdown: string, node: ListItem): string => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? "" : markdown.slice(start, end);
};

const taskItemBodySource = (source: string): string | undefined => {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const opening = lines[0]?.match(TASK_ITEM_PREFIX);
  if (opening?.[2]?.trim() !== "$$") {
    return undefined;
  }

  const markerIndent = opening[1]?.match(/^[ \t]*/)?.[0].length ?? 0;
  const continuationWidth = markerIndent + 2;
  const body = [
    opening[2],
    ...lines.slice(1).map((line) => {
      if (!line.trim()) {
        return "";
      }
      return line.slice(0, continuationWidth).trim() ? line : line.slice(continuationWidth);
    }),
  ].join("\n");
  return body;
};

const parseTaskItemBody = (source: string): Root => {
  const body = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(source);
  visit(body, (node) => {
    delete node.position;
  });
  return body;
};

export const normalizeTaskListBlockMath = (tree: Root, markdown: string): void => {
  visit(tree, "listItem", (node: ListItem) => {
    if (node.checked === null || node.checked === undefined) {
      return;
    }

    const bodySource = taskItemBodySource(sourceForNode(markdown, node));
    if (!bodySource) {
      return;
    }
    const body = parseTaskItemBody(bodySource);
    if (body.children[0]?.type !== "math") {
      return;
    }
    node.children = body.children as ListItem["children"];
  });
};

export const remarkTaskListBlockMath: Plugin<[], Root> =
  () =>
  (tree, file): void => {
    normalizeTaskListBlockMath(tree, String(file));
  };
