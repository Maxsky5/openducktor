import type { ReactElement, ReactNode } from "react";
/** The style of a short code value, such as a branch name or a command, inside text. */
export const INLINE_CODE_CLASS_NAME =
  "rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground";

const CODE_SPAN_PATTERN = /`([^`]+)`/g;

/** Shows text, with each value between backticks as inline code. */
export function InlineCodeText({ text }: { text: string }): ReactElement {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(CODE_SPAN_PATTERN)) {
    nodes.push(text.slice(cursor, match.index));
    nodes.push(
      <code key={match.index} className={INLINE_CODE_CLASS_NAME}>
        {match[1]}
      </code>,
    );
    cursor = match.index + match[0].length;
  }
  nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}
