import type { ReactElement } from "react";

type AppUpdateProgressProps = {
  percent: number;
};

export function AppUpdateProgress({ percent }: AppUpdateProgressProps): ReactElement {
  const roundedPercent = Math.round(percent);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Update download progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={roundedPercent}
        aria-valuetext={`${roundedPercent}% downloaded`}
      >
        <div
          className="h-full bg-sidebar-accent transition-[width] duration-150 ease-out motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{roundedPercent}% downloaded</p>
    </div>
  );
}
