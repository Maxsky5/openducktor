import { Circle } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { cn } from "@/lib/utils";

const sizeClasses = {
  sm: "size-2.5",
  md: "size-3.5",
};

type RunningStatusDotProps = Omit<ComponentProps<"span">, "children"> & {
  size?: keyof typeof sizeClasses;
};

export function RunningStatusDot({
  size = "md",
  className,
  "aria-hidden": ariaHidden = true,
  ...props
}: RunningStatusDotProps): ReactElement {
  return (
    <span
      {...props}
      aria-hidden={ariaHidden}
      className={cn("running-status-dot", sizeClasses[size], className)}
    >
      {size === "md" ? (
        <Circle className="relative z-1 size-3 fill-status-running text-status-running" />
      ) : (
        <span className="relative z-1 size-full rounded-full bg-status-running" />
      )}
    </span>
  );
}
