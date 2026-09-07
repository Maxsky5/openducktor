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
};

type SettingsButtonProps = SettingsModalTriggerProps & {
  onClick?: () => void;
};

type SettingsModalOpenButtonProps = SettingsModalTriggerProps & {
  onClick: () => void;
};

function SettingsButton({
  className,
  iconOnly,
  label,
  size,
  onClick,
}: SettingsButtonProps): ReactElement {
  return (
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
}

export function SettingsModalTrigger({
  className,
  iconOnly,
  label,
  size,
}: SettingsModalTriggerProps): ReactElement {
  const button = (
    <SettingsButton className={className} iconOnly={iconOnly} label={label} size={size} />
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

export function SettingsModalOpenButton({
  className,
  iconOnly,
  label,
  size,
  onClick,
}: SettingsModalOpenButtonProps): ReactElement {
  const button = (
    <SettingsButton
      className={className}
      iconOnly={iconOnly}
      label={label}
      size={size}
      onClick={onClick}
    />
  );

  if (!iconOnly) return button;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="top">
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
