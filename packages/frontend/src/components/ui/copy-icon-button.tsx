import { Check, Copy } from "lucide-react";
import { type ComponentProps, type MouseEventHandler, type ReactElement, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useOnSessionViewHide } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import { cn } from "@/lib/utils";

type CopyIconButtonProps = {
  copied: boolean;
  ariaLabel: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  className?: string;
  dataTestId?: string;
  tooltipLabel?: string;
  tooltipSide?: ComponentProps<typeof TooltipContent>["side"];
};

export function CopyIconButton({
  copied,
  ariaLabel,
  onClick,
  className,
  dataTestId,
  tooltipLabel = "Copy",
  tooltipSide = "left",
}: CopyIconButtonProps): ReactElement {
  // The button stays mounted with the hidden view, so an open tooltip would show again on return.
  const [isTooltipOpen, setTooltipOpen] = useState(false);
  useOnSessionViewHide(() => setTooltipOpen(false));
  return (
    <TooltipProvider>
      <Tooltip open={isTooltipOpen} onOpenChange={setTooltipOpen}>
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
        <TooltipContent side={tooltipSide}>
          <p>{tooltipLabel}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
