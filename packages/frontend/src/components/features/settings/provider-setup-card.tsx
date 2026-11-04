import type { ComponentType, ReactElement, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type ProviderSetupCardProps = {
  /** The provider name, as in "GitLab setup" and "Enable GitLab provider". */
  providerLabel: string;
  headingId: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
  enabled: boolean;
  disabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  readiness: { label: string; variant: "success" | "outline" | "warning" };
  children: ReactNode;
};

/** The card of a REST Git provider's repository setup, with its readiness and switch. */
export function ProviderSetupCard({
  providerLabel,
  headingId,
  icon: Icon,
  description,
  enabled,
  disabled,
  onEnabledChange,
  readiness,
  children,
}: ProviderSetupCardProps): ReactElement {
  return (
    <Card className="min-w-0" role="region" aria-labelledby={headingId}>
      <CardHeader className="gap-4 border-b border-border pb-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-foreground">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 space-y-1">
            <CardTitle id={headingId}>{providerLabel} setup</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Badge variant={readiness.variant}>{readiness.label}</Badge>
          <Label className="flex items-center gap-2 text-xs font-medium text-foreground">
            <Switch
              aria-label={`Enable ${providerLabel} provider`}
              checked={enabled}
              disabled={disabled}
              onCheckedChange={onEnabledChange}
            />
            {enabled ? "Enabled" : "Disabled"}
          </Label>
        </div>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-6">{children}</CardContent>
    </Card>
  );
}
