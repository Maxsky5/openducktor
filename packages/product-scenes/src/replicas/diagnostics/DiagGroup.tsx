// DiagnosticsGroup and DiagnosticsCard of diagnostics-card.tsx: the label and the scope of a group
// over its cards. Each card has a title row, and its checks are rows that dividers separate.
import type { ReactElement, ReactNode } from "react";
import "./DiagGroup.css";

type DiagGroupProps = { title: string; description: string; children?: ReactNode };

export function DiagGroup({ title, description, children }: DiagGroupProps): ReactElement {
  return (
    <div className="diag-group">
      <div className="diag-group-head">
        <p>{title}</p>
        <small>{description}</small>
      </div>
      {children}
    </div>
  );
}
