/** A list item. `line` is its first line in the message, so it is a stable key. */
export type CommitBodyItem = { line: number; text: string };

/** One block of a commit body: a paragraph of joined lines, or a list of items. */
export type CommitBodyBlock =
  | { kind: "paragraph"; line: number; text: string }
  | { kind: "list"; line: number; items: CommitBodyItem[] };

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/u;

/**
 * The body of a commit message without its subject. Git wraps bodies at a fixed width, so the
 * lines of a paragraph join into one line that the view can wrap. List items stay separate.
 */
export function commitBodyBlocks(message: string): CommitBodyBlock[] {
  const lines = message.replace(/\r\n?/gu, "\n").split("\n");
  // The first paragraph is the subject, which the view shows apart from the body.
  const bodyStart = lines.findIndex((line) => line.trim() === "");
  if (bodyStart === -1) return [];
  const blocks: CommitBodyBlock[] = [];
  let paragraph: { line: number; parts: string[] } | null = null;
  let list: CommitBodyItem[] = [];
  const flush = (): void => {
    if (paragraph) {
      blocks.push({ kind: "paragraph", line: paragraph.line, text: paragraph.parts.join(" ") });
    }
    const [first] = list;
    if (first) blocks.push({ kind: "list", line: first.line, items: list });
    paragraph = null;
    list = [];
  };
  lines.forEach((raw, lineNumber) => {
    if (lineNumber <= bodyStart) return;
    const line = raw.trim();
    if (line === "") {
      flush();
      return;
    }
    if (LIST_ITEM.test(raw)) {
      if (paragraph) flush();
      list.push({ line: lineNumber, text: line.replace(LIST_ITEM, "") });
      return;
    }
    const lastItem = list.at(-1);
    if (lastItem) {
      // A wrapped list item continues on the next line.
      lastItem.text = `${lastItem.text} ${line}`;
      return;
    }
    if (paragraph) paragraph.parts.push(line);
    else paragraph = { line: lineNumber, parts: [line] };
  });
  flush();
  return blocks;
}

/** The body as one line, for a row that shows it after the subject. */
export function commitBodyPreview(message: string): string {
  return commitBodyBlocks(message)
    .map((block) =>
      block.kind === "paragraph" ? block.text : block.items.map((item) => item.text).join(" · "),
    )
    .join(" ");
}
