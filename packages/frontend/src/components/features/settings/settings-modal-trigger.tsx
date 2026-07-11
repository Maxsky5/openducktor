import { Settings2 } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type SettingsModalTriggerProps = {
  className?: string | undefined;
  iconOnly: boolean;
  label: string;
  size: "default" | "sm" | "lg" | "icon";
};

export function SettingsModalTrigger({
  className,
  iconOnly,
  label,
  size,
}: SettingsModalTriggerProps): ReactElement {
  const button = (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={cn(className)}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
    >
      <Settings2 />
      {iconOnly ? null : label}
    </Button>
  );

  if (!iconOnly) {
    return <DialogTrigger asChild>{button}</DialogTrigger>;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <DialogTrigger asChild>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
        </DialogTrigger>
        <TooltipContent side="top">
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
