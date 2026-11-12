// The stack header of a work view in the mobile app, as stack-header.tsx in
// apps/mobile/src/navigation and work-header-title.tsx in apps/mobile/src/features/work-owner:
// Back, the title at the start with an optional second line, such as the folder of a file, and
// Refresh.
import { ArrowLeft, RefreshCcw } from "lucide-react";
import type { ReactElement } from "react";
import "./StackHeader.css";

/** The stack header of a work view: Back, the title with an optional second line, and Refresh. */
export function StackHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}): ReactElement {
  return (
    <header className="mob-stack-header">
      <span className="mob-stack-back" data-back="">
        <ArrowLeft />
      </span>
      <span className="mob-stack-title">
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </span>
      <span className="mob-stack-action">
        <RefreshCcw />
      </span>
    </header>
  );
}
