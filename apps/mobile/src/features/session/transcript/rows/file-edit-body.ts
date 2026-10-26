import type { FileEditData } from "@openducktor/frontend-core/sessions/messages/file-edit-tool";
import {
  buildDiffRows,
  buildFileDiffRows,
  buildReplacementDiffRows,
  type DiffRow,
} from "@/rich-content/diff/diff-row-model";

/**
 * What an open file edit card shows, as the desktop `AgentChatFileEditCard`: diff rows for a
 * diff or an edit fragment, or the text of a new file or a write input. `label` names a body
 * that is not an applied change yet.
 */
export type FileEditBody =
  | { kind: "diff"; label: string | null; rows: readonly DiffRow[] }
  | { kind: "content"; label: string | null; content: string };

/** The body of an open card, or null for a card that has only a path. */
export const fileEditBody = (data: FileEditData): FileEditBody | null => {
  switch (data.kind) {
    case "diff":
      return {
        kind: "diff",
        label: null,
        rows: buildFileDiffRows(data.diff, data.filePath) ?? buildDiffRows(data.diff),
      };
    case "replacement":
      return {
        kind: "diff",
        label: "Edit fragment",
        rows: buildReplacementDiffRows(data.oldContent, data.newContent, data.filePath),
      };
    case "content":
      return { kind: "content", label: null, content: data.content };
    case "write-input":
      return { kind: "content", label: "Write input", content: data.content };
    case "path":
      return null;
  }
};
