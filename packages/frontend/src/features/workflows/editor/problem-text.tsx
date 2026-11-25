import type { ReactElement } from "react";
import { useEditorView } from "./editor-context";
import { messageParts } from "./model/problem-message";

/**
 * A problem message with each quoted label in typographic quotes. A quoted ID of an element shows
 * the name that the editor gives it, and any other ID shows in code style. The problems panel, the
 * inspector, and the publish dialog show messages with it.
 */
export function ProblemText({ message }: { message: string }): ReactElement {
  const names = useEditorView((view) => view.elementNames);
  let at = 0;
  return (
    <>
      {messageParts(message).map(({ kind, text: quoted }) => {
        // The place of the part in the message, which no other part shares.
        const key = at;
        at += quoted.length + 1;
        const named = kind === "id" ? names.get(quoted) : undefined;
        const text = named ?? quoted;
        if (kind === "id" && named === undefined)
          return (
            <code key={key} className="rounded bg-muted px-1 py-px font-mono text-[0.85em]">
              {text}
            </code>
          );
        if (kind === "label" || named !== undefined)
          return (
            <span key={key} className="font-medium">
              “{text}”
            </span>
          );
        return <span key={key}>{text}</span>;
      })}
    </>
  );
}
