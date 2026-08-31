import { Settings } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type SettingsModalTriggerProps = {
  className?: string | undefined;
  iconOnly: boolean;
  label: string;
  size: "default" | "sm" | "lg" | "icon";
  onClick?: () => void;
  standalone?: boolean;
};

export function SettingsModalTrigger({
  className,
  iconOnly,
  label,
  size,
  onClick,
  standalone = false,
}: SettingsModalTriggerProps): ReactElement {
  const button = (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={className}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      onClick={onClick}
    >
      <Settings />
      {iconOnly ? null : label}
    </Button>
  );

  if (!iconOnly) {
    if (standalone) return button;
    return <DialogTrigger asChild>{button}</DialogTrigger>;
  }

  let tooltipTrigger = <TooltipTrigger asChild>{button}</TooltipTrigger>;
  if (!standalone) {
    tooltipTrigger = <DialogTrigger asChild>{tooltipTrigger}</DialogTrigger>;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        {tooltipTrigger}
        <TooltipContent side="top">
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
