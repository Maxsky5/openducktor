import type { ReactElement, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** An icon button whose tooltip names its action. A disabled button explains why. */
export function CardIconButton({
  label,
  hint = label,
  describedBy,
  disabled,
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  describedBy?: string | undefined;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A disabled button gets no pointer events, so the wrapper shows the tooltip. */}
        <span className="inline-flex">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={label}
            aria-describedby={describedBy}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{hint}</TooltipContent>
    </Tooltip>
  );
}
