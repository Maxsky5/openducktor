// The Diagnostics sheet of diagnostics-panel.tsx: the title, Refresh, the close button, the
// overview, and the groups in the children. Refresh is disabled, and its icon spins, while the
// checks run.
import { RefreshCcw, ShieldCheck, X } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { classes } from "../classes";
import { Replica } from "../Replica";
import { Button } from "../ui/Button";
import { DiagOverview } from "./DiagOverview";
import type { DiagOverviewData } from "./model";
import "./DiagnosticsSheet.css";

type DiagnosticsSheetProps = ComponentProps<"div"> & { overview: DiagOverviewData };

export function DiagnosticsSheet({
  overview,
  className,
  children,
  ...attributes
}: DiagnosticsSheetProps): ReactElement {
  return (
    <Replica className={classes("diag-sheet", className)} {...attributes}>
      <div className="diag-header">
        <strong>
          <ShieldCheck className="diag-shield" />
          Diagnostics
        </strong>
        <Button variant="outline" size="sm" className="diag-refresh" data-refresh>
          <RefreshCcw className="i14" />
          <span data-refresh-label="">Refresh</span>
        </Button>
        <span className="diag-close">
          <X />
        </span>
      </div>
      <div className="diag-body" data-diag-scroll="">
        <DiagOverview {...overview} />
        {children}
      </div>
    </Replica>
  );
}
