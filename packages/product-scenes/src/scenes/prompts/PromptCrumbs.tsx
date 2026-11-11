// PromptPageHeader of settings-prompt-rows.tsx in packages/frontend/src/components/features/settings:
// the back link to the screen that opened the page, then the title and its marks in one row.
import { ArrowLeft, ChevronRight } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import "./PromptCrumbs.css";

export function PromptCrumbs({
  backTitle,
  title,
  children,
}: {
  backTitle: string;
  title: string;
  /** Marks after the title, such as the status badges of a prompt. */
  children?: ReactNode;
}): ReactElement {
  return (
    <div className="pc-crumbs">
      <span className="pc-back">
        <ArrowLeft className="i14" />
        {backTitle}
      </span>
      <ChevronRight className="i14" />
      <strong>{title}</strong>
      {children}
    </div>
  );
}
