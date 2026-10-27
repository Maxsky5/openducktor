import { type ReactElement, useId } from "react";
import { Switch } from "@/components/ui/switch";

type SettingsSwitchRowProps = {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  ariaLabel: string;
  onCheckedChange: (checked: boolean) => void;
};

/** One on or off setting: its title and description, with the switch centered beside them. */
export function SettingsSwitchRow({
  title,
  description,
  checked,
  disabled,
  ariaLabel,
  onCheckedChange,
}: SettingsSwitchRowProps): ReactElement {
  const descriptionId = useId();
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p id={descriptionId} className="text-xs text-muted-foreground">
            {description}
          </p>
        </div>
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-describedby={descriptionId}
        />
      </div>
    </div>
  );
}
