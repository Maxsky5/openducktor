// The words and the data of the Import session dialog, which the view and the scene steps share.
// This module loads no React and no styles. Sources: workspace-session-import-dialog.tsx,
// workspace-session-import-search.tsx, and workspace-session-import-results.tsx.
import type { RuntimeKind } from "../../sample/models";

/** The words of the dialog. */
export const IMPORT_TEXT = {
  title: "Import session",
  description: "Continue an existing conversation from this repository or one of its worktrees.",
  runtime: "Runtime",
  runtimePlaceholder: "Choose a runtime",
  search: "Search sessions",
  searchPlaceholder: "Title, session ID, or directory",
  finding: "Finding sessions…",
  searching: "Searching sessions…",
  slow: "Large histories can take longer. You can switch runtime or cancel.",
  sessionId: "Session ID",
  import: "Import",
  importing: "Importing…",
} as const;

/** A runtime of the option list: its kind and the label of its definition. */
export type ImportRuntime = { kind: RuntimeKind; label: string };

/** A row of the list: the fields of `WorkspaceSessionExternal` and the time that the row shows. */
export type ExternalSession = {
  id: string;
  title: string;
  directory: string;
  /** The relative time of formatCiRelativeTime, such as 2h ago. */
  updated: string;
};

/** The session count under the list: 1 session, 2 sessions. */
export function sessionCount(count: number): string {
  return `${count} ${count === 1 ? "session" : "sessions"}`;
}
