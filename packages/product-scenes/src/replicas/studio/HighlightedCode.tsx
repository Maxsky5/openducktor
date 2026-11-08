// One line of sample code in its token colors, from tokenize in highlight.ts. The diffs of the
// desktop and of the mobile app use it.
import type { ReactNode } from "react";
import { tokenize } from "./highlight";

export function HighlightedCode({ line }: { line: string }): ReactNode {
  return tokenize(line).map((token, part) =>
    token.tone ? (
      // The tokens of a line never change order, so the index is a stable key.
      <span className={token.tone} key={part}>
        {token.text}
      </span>
    ) : (
      token.text
    ),
  );
}
