import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

/** A progress bar for a known total. */
export function BrowserProgressBar({
  value,
  total,
  label,
  className,
}: {
  value: number;
  total: number;
  /** The accessible name, such as the file name. */
  label: string;
  className?: string;
}): ReactElement {
  const percent = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
