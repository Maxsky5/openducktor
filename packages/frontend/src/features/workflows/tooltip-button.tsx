import type { ComponentProps, ReactElement, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type TooltipButtonProps = Omit<ComponentProps<typeof Button>, "aria-label" | "title"> & {
  /** The accessible name of the button and the default tooltip. */
  label: string;
  /** The tooltip text, such as the reason that the button is disabled. */
  tooltip?: ReactNode;
};

/**
 * An icon button with its name in a tooltip. A disabled button still shows its tooltip: the
 * tooltip opens from a focusable wrapper, because a disabled button gets no pointer events.
 * Put a `TooltipProvider` around the buttons.
 */
export function TooltipButton({
  label,
  tooltip = label,
  disabled,
  ...props
}: TooltipButtonProps): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex rounded-md" tabIndex={disabled ? 0 : undefined}>
          <Button aria-label={label} disabled={disabled} {...props} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
