import { Check, Copy } from "lucide-react";
import type { MouseEventHandler, ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type CopyIconButtonProps = {
  copied: boolean;
  ariaLabel: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  className?: string;
  dataTestId?: string;
  tooltipLabel?: string;
};

export function CopyIconButton({
  copied,
  ariaLabel,
  onClick,
  className,
  dataTestId,
  tooltipLabel = "Copy",
}: CopyIconButtonProps): ReactElement {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={cn(
              "size-7 text-muted-foreground hover:bg-accent hover:text-foreground",
              className,
            )}
            aria-label={ariaLabel}
            {...(dataTestId ? { "data-testid": dataTestId } : {})}
            onClick={onClick}
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-500 dark:text-emerald-400" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>{tooltipLabel}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
