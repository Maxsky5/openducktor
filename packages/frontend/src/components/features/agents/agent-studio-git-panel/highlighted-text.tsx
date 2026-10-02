import type { ReactElement, ReactNode } from "react";
import type { RowLabel } from "./file-list-rows";

export function HighlightedText({ label }: { label: RowLabel }): ReactElement {
  const { text, highlights } = label;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const { start, end } of highlights) {
    if (start > cursor) {
      parts.push(text.slice(cursor, start));
    }
    parts.push(
      <mark key={start} className="rounded-sm bg-selected-surface text-foreground">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return <>{parts}</>;
}
