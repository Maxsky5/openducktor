// The preview of an HTML artifact: the isolated frame of IsolatedHtmlFrame in
// task-artifact-html-preview.tsx. The frame fills the place of the preview, and the page of the
// artifact in the children sets its own look and paints its own background.
import type { ReactElement, ReactNode } from "react";
import "./HtmlPreview.css";

export function HtmlPreview({ children }: { children: ReactNode }): ReactElement {
  return <div className="ar-frame">{children}</div>;
}
