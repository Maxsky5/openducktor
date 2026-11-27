// The readiness line under the canvas: ProblemsPanel of panels/problems-panel.tsx in
// packages/frontend/src/features/workflows/editor, with the words of readiness.ts. A green check
// when nothing needs a look, else the marker of the worst problem, the title, the detail, and Show
// while the problem list is closed. A scene sets `data-level` and the two texts.
import { AlertTriangle, ChevronUp, CircleCheck } from "lucide-react";
import type { ReactElement } from "react";
import type { Readiness } from "./model";
import { PROBLEMS_TEXT } from "./text";
import "./ProblemsBar.css";

export function ProblemsBar({ level, title, detail }: Readiness): ReactElement {
  return (
    <div className="wfe-problems" data-problems="" data-level={level ?? "none"}>
      <CircleCheck className="wfe-problems-ready" />
      <AlertTriangle className="wfe-problems-warning" />
      <span className="wfe-problems-text">
        <b data-problems-title="">{title}</b>
        <span className="wfe-problems-detail" data-problems-detail="" hidden={detail === null}>
          <span>· </span>
          <span data-problems-detail-text="">{detail}</span>
        </span>
      </span>
      <span className="wfe-problems-toggle">
        {PROBLEMS_TEXT.show}
        <ChevronUp className="i14" />
      </span>
    </div>
  );
}
