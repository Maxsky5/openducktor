import type { ReactElement, ReactNode } from "react";

const COMMAND_PATTERN = /`([^`]+)`/g;

/** Shows a runtime check message, with the commands that it puts between backticks as code. */
export function RuntimeMessageText({ text }: { text: string }): ReactElement {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(COMMAND_PATTERN)) {
    nodes.push(text.slice(cursor, match.index));
    nodes.push(
      <code key={match.index} className="rounded bg-muted px-1 font-mono text-xs">
        {match[1]}
      </code>,
    );
    cursor = match.index + match[0].length;
  }
  nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}
