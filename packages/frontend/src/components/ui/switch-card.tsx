import type { LucideIcon } from "lucide-react";
import { type ReactElement, type ReactNode, useId } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** A bordered option with an icon, a label, and a switch. The details of the option go below. */
export function SwitchCard({
  icon: Icon,
  label,
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  icon: LucideIcon;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean | undefined;
  children?: ReactNode;
}): ReactElement {
  const switchId = useId();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex items-center gap-3">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Label htmlFor={switchId} className="flex-1 cursor-pointer leading-5">
          {label}
        </Label>
        <Switch
          id={switchId}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
        />
      </div>
      {children}
    </div>
  );
}
