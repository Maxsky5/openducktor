// DiagnosticsOverview of diagnostics-overview.tsx: the verdict at the top of the sheet. The checks
// run with a spinner, then a green card says that everything works.
import { CircleCheck, LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import type { DiagOverviewData } from "./model";
import "./DiagOverview.css";

export function DiagOverview({ tone, title, description }: DiagOverviewData): ReactElement {
  return (
    <div className="diag-overview" data-tone={tone} data-diag-overview="">
      <span className="diag-overview-icon">
        <CircleCheck />
        <LoaderCircle className="spin" />
      </span>
      <div>
        <p data-diag-overview-title="">{title}</p>
        <small data-diag-overview-text="">{description}</small>
      </div>
    </div>
  );
}
