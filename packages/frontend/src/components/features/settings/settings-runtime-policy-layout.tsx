import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function RuntimePolicyCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="@container flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-col gap-1">
        <h4 className="text-base font-semibold text-foreground">{title}</h4>
        <p className="text-sm text-muted-foreground">
          Configure the default value, then opt into role-specific overrides only when needed.
        </p>
      </div>
      {children}
    </section>
  );
}

export function RuntimePolicyInfo({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-info-border bg-info-surface px-3 py-3 text-foreground">
      {children}
    </div>
  );
}

export function RuntimePolicyDefault({
  label,
  labelId,
  description = "Used by every role unless that role overrides it.",
  children,
}: {
  label: string;
  labelId: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-3 border-t border-border pt-4 @min-[34rem]:grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)] @min-[34rem]:items-center">
      <div className="flex flex-col gap-1">
        <Label id={labelId} className="text-sm font-medium text-foreground">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function RuntimePolicyRoleOverrides({
  id,
  label,
  enabled,
  disabled,
  onEnabledChange,
  children,
}: {
  id: string;
  label: string;
  enabled: boolean;
  disabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor={id} className="text-sm font-medium text-foreground">
            Role overrides
          </Label>
          <p className="text-xs text-muted-foreground">
            Enable this only when a role needs a different value for this setting.
          </p>
        </div>
        <Switch
          id={id}
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onEnabledChange}
          aria-label={`Enable ${label} role overrides`}
        />
      </div>
      {enabled ? children : null}
    </div>
  );
}
