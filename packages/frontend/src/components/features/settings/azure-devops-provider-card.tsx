import { Cloud } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import type { AzureProviderReadiness } from "./azure-devops-provider-readiness";

type AzureDevOpsProviderCardProps = {
  enabled: boolean;
  disabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  readiness: AzureProviderReadiness;
  description: string;
  children: ReactNode;
};

export function AzureDevOpsProviderCard({
  enabled,
  disabled,
  onEnabledChange,
  readiness,
  description,
  children,
}: AzureDevOpsProviderCardProps): ReactElement {
  return (
    <Card className="min-w-0" role="region" aria-labelledby="azure-devops-heading">
      <CardHeader className="gap-4 border-b border-border pb-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-foreground">
            <Cloud className="size-4" />
          </span>
          <div className="min-w-0 space-y-1">
            <CardTitle id="azure-devops-heading">Azure DevOps setup</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Badge variant={readiness.variant}>{readiness.label}</Badge>
          <Label className="flex items-center gap-2 text-xs font-medium text-foreground">
            <Switch
              aria-label="Enable Azure DevOps provider"
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
