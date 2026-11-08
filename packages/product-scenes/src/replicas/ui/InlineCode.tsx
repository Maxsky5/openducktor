// Text with inline code spans, which the text marks with backticks, as the compact Markdown of the
// app renders it. The transcripts, the task cards, and the review comments use it.
import type { ReactElement, ReactNode } from "react";

/** The parts of `text`: the text between backticks shows as code. */
export function InlineCode({ text }: { text: string }): ReactNode {
  return text.split("`").map((part, index) =>
    // The parts of a split never change order, so the index is a stable key.
    index % 2 === 1 ? <code key={index}>{part}</code> : part,
  );
}

/** A paragraph with its inline code spans. */
export function Paragraph({ text, className }: { text: string; className?: string }): ReactElement {
  return (
    <p className={className}>
      <InlineCode text={text} />
    </p>
  );
}
