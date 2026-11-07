// DiagnosticsCard of diagnostics-card.tsx: the title row, then the rows.
import type { ReactElement, ReactNode } from "react";
import "./DiagCard.css";

type DiagCardProps = {
  /** The content of the title row. */
  title: ReactNode;
  children?: ReactNode;
};

export function DiagCard({ title, children }: DiagCardProps): ReactElement {
  return (
    <div className="diag-card">
      <div className="diag-card-title">{title}</div>
      {children}
    </div>
  );
}
