import { markdownBlockGap } from "@/rich-content/markdown/markdown-spacing";
import type {
  MarkdownBlock,
  MarkdownDefinitions,
  TaskImageContext,
} from "@/rich-content/markdown/markdown-view";
import { buildDocumentRows, type DocumentSource } from "./document-rows";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const twoDigits = (value: number): string => String(value).padStart(2, "0");

/**
 * The desktop date of a document change in local time, such as "Sep 19, 04:59 PM", or null
 * without one. The text does not come from `Intl`, because each JavaScript engine joins the
 * date parts in its own way.
 */
export const formatDocumentUpdatedAt = (iso: string | null): string | null => {
  if (!iso) return null;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return null;
  const hours = value.getHours();
  const time = `${twoDigits(hours % 12 === 0 ? 12 : hours % 12)}:${twoDigits(value.getMinutes())}`;
  return `${MONTHS[value.getMonth()]} ${twoDigits(value.getDate())}, ${time} ${hours < 12 ? "AM" : "PM"}`;
};

/** One Markdown block of a document, with the space above it. */
export type DocumentBlockRow = {
  key: string;
  block: MarkdownBlock;
  definitions: MarkdownDefinitions;
  imageContext: TaskImageContext | null;
  /** The collapsed desktop margin between this block and the block above it. */
  gap: number;
};

/** What the body of the Documents view shows for the selected document. */
export type DocumentPanelState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | {
      kind: "ready";
      rows: DocumentBlockRow[];
      /** The Markdown of the document for Copy, one blank line between top-level blocks. */
      markdown: string;
    };

/** The body state of one document, from the same rows as the task details documents. */
export const documentPanelState = (source: DocumentSource): DocumentPanelState => {
  const rows: DocumentBlockRow[] = [];
  let previous: MarkdownBlock | undefined;
  for (const row of buildDocumentRows([source])) {
    if (row.kind === "doc_state") {
      if (row.state === "loading") return { kind: "loading" };
      if (row.state === "error") return { kind: "error", message: row.message };
      return { kind: "empty" };
    }
    if (row.kind !== "doc_block") continue;
    rows.push({
      key: row.key,
      block: row.block,
      definitions: row.definitions,
      imageContext: row.imageContext,
      gap: markdownBlockGap(previous, row.block, "document"),
    });
    previous = row.block;
  }
  return {
    kind: "ready",
    rows,
    markdown: rows.map((row) => row.block.source).join("\n\n"),
  };
};

export const documentMenuItems = (sources: ReadonlyMap<string, DocumentSource>, selected: string) =>
  Array.from(sources.values(), (source) => ({
    id: source.key,
    title: source.title,
    detail: formatDocumentUpdatedAt(source.updatedAt) ?? "Not set",
    checked: source.key === selected,
  }));
