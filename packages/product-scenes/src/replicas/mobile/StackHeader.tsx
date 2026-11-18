// The stack header of a work view in the mobile app, as stack-header.tsx in
// apps/mobile/src/navigation and work-header-title.tsx in apps/mobile/src/features/work-owner:
// the Material toolbar of Android with Back in its 56 dp navigation box, the title at the start
// with an optional second line, such as the folder of a file, and Refresh.
import { ArrowLeft, RefreshCw } from "lucide-react";
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
      <span className="mob-stack-nav">
        <span className="mob-stack-back" data-back="" data-feedback="opacity">
          <ArrowLeft />
        </span>
      </span>
      <span className="mob-stack-title">
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </span>
      <span className="mob-stack-action">
        <RefreshCw />
      </span>
    </header>
  );
}
