import type { ReactElement } from "react";
import { matchedRanges } from "./command-palette-match-ranges";

/** The text with the parts that the query finds marked. A mark does not change the text width. */
export function MatchedText({ text, query }: { text: string; query: string }): ReactElement {
  const parts: (string | ReactElement)[] = [];
  let cursor = 0;
  for (const { start, end } of matchedRanges(text, query)) {
    parts.push(text.slice(cursor, start));
    parts.push(
      <mark key={start} className="rounded-[3px] bg-primary/15 text-inherit dark:bg-primary/35">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
