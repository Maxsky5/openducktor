// The status pill of diagnostics-status.tsx: a colored dot, or a spinner while the check works.
import { LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import type { DiagStatusData } from "./model";
import "./DiagStatus.css";

export function DiagStatus({ status }: { status: DiagStatusData }): ReactElement {
  return (
    <span className="diag-pill" data-health={status.health} data-diag-pill="">
      <LoaderCircle className="i12 spin" />
      <i />
      <span data-diag-label="">{status.label}</span>
    </span>
  );
}
