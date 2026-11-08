// A Markdown document, as the prose classes of the product render it. The headings of a document
// are not headings of the page, so DocHeading draws them without heading elements.
import type { ReactElement, ReactNode } from "react";
import "./Prose.css";

export function Prose({ children }: { children?: ReactNode }): ReactElement {
  return (
    <div className="doc" data-prose="">
      {children}
    </div>
  );
}
