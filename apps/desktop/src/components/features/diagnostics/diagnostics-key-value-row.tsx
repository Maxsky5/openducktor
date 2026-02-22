import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import type { DiagnosticKeyValueRowModel } from "./diagnostics-panel-model";

export function DiagnosticsKeyValueRow({
  label,
  value,
  mono = false,
  breakAll = false,
  valueClassName,
}: DiagnosticKeyValueRowModel): ReactElement {
  return (
    <p className="text-xs text-slate-700">
      <span className="font-medium text-slate-600">{label}:</span>{" "}
      <span
        className={cn(
          mono ? "font-mono text-[11px]" : "",
          breakAll ? "break-all" : "",
          valueClassName,
        )}
      >
        {value}
      </span>
    </p>
  );
}
