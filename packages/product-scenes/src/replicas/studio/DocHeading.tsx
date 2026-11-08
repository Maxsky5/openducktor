// A heading of a Markdown document in the Artifacts panel. It has the look of the product
// heading, but it is not a heading of the page.
import type { ReactElement, ReactNode } from "react";

type DocHeadingProps = { level: 1 | 2 | 3; children?: ReactNode };

export function DocHeading({ level, children }: DocHeadingProps): ReactElement {
  return <div className={`doc-h${level}`}>{children}</div>;
}
