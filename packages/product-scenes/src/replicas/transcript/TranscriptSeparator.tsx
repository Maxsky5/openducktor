// A separator row between two rows of a desktop transcript: a line on each side of its label, as
// agent-transcript-separator.tsx draws it. The history of a Codex fork has one where the turns of
// the fork start: codexForkBoundaryHistoryMessage of codex-fork-boundary.ts in
// packages/adapters-codex-app-server.
import type { ReactElement } from "react";
import "./TranscriptSeparator.css";

export function TranscriptSeparator({ label, row }: { label: string; row?: string }): ReactElement {
  return (
    <p className="st-separator" data-row={row}>
      <span>{label}</span>
    </p>
  );
}
