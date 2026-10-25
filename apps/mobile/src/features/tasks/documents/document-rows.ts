import type { MarkdownBlock, MarkdownDefinitions } from "@/rich-content/markdown/markdown-view";
import type { TaskImageContext } from "@/rich-content/markdown/markdown-view";
import type { Tone } from "@/ui/tones";

type TaskDocumentKey = "description" | "spec" | "plan" | "qa";
/** The documents that the host stores and the view reads again on Retry. */
export type HostDocumentKey = Exclude<TaskDocumentKey, "description">;

/** One document as the rows need it. `blocks` is null while its text is not loaded. */
export type DocumentSource = {
  key: TaskDocumentKey;
  title: string;
  empty: string;
  updatedAt: string | null;
  /** The document exists on the host, as the task summary reports. */
  exists: boolean;
  isLoading: boolean;
  error: string | null;
  blocks: readonly MarkdownBlock[] | null;
  definitions: MarkdownDefinitions;
  imageContext: TaskImageContext | null;
  /** A badge next to the title, such as the QA verdict. */
  badge: { label: string; tone: Tone } | null;
};

export type DocumentRow =
  | {
      kind: "doc_header";
      key: string;
      document: TaskDocumentKey;
      title: string;
      updatedAt: string | null;
      badge: DocumentSource["badge"];
    }
  | {
      kind: "doc_state";
      key: string;
      document: TaskDocumentKey;
      title: string;
      /** `empty` and `loading` are normal states; `error` offers Retry for host documents. */
      state: "empty" | "loading" | "error";
      message: string;
    }
  | {
      kind: "doc_block";
      key: string;
      document: TaskDocumentKey;
      block: MarkdownBlock;
      definitions: MarkdownDefinitions;
      imageContext: TaskImageContext | null;
      /** The first and last block of the document, so a surface rounds its corners there. */
      first: boolean;
      last: boolean;
    };

/**
 * The list rows of task documents: a header for each document, then its top-level Markdown
 * blocks or one state row. Long documents scroll as list rows, so only visible blocks render.
 */
export const buildDocumentRows = (sources: readonly DocumentSource[]): DocumentRow[] =>
  sources.flatMap((source): DocumentRow[] => {
    const header: DocumentRow = {
      kind: "doc_header",
      key: `${source.key}:header`,
      document: source.key,
      title: source.title,
      updatedAt: source.updatedAt,
      badge: source.badge,
    };
    const state = (kind: "empty" | "loading" | "error", message: string): DocumentRow => ({
      kind: "doc_state",
      key: `${source.key}:state`,
      document: source.key,
      title: source.title,
      state: kind,
      message,
    });
    if (source.error) return [header, state("error", source.error)];
    if (!source.exists) return [header, state("empty", source.empty)];
    if (source.blocks === null || source.isLoading) {
      return [header, state("loading", `Loading the ${source.title.toLowerCase()}.`)];
    }
    if (source.blocks.length === 0) return [header, state("empty", source.empty)];
    const lastIndex = source.blocks.length - 1;
    return [
      header,
      ...source.blocks.map((block, index): DocumentRow => ({
        kind: "doc_block",
        key: `${source.key}:${block.key}`,
        document: source.key,
        block,
        definitions: source.definitions,
        imageContext: source.imageContext,
        first: index === 0,
        last: index === lastIndex,
      })),
    ];
  });
