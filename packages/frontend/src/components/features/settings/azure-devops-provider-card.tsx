import { AZURE_DEVOPS_PROVIDER_DESCRIPTOR } from "@openducktor/contracts";
import { Cloud } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { AzureProviderReadiness } from "./azure-devops-provider-readiness";
import { ProviderSetupCard } from "./provider-setup-card";

type AzureDevOpsProviderCardProps = {
  enabled: boolean;
  disabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  readiness: AzureProviderReadiness;
  description: string;
  children: ReactNode;
};

export function AzureDevOpsProviderCard(props: AzureDevOpsProviderCardProps): ReactElement {
  return (
    <ProviderSetupCard
      {...props}
      providerLabel={AZURE_DEVOPS_PROVIDER_DESCRIPTOR.label}
      headingId="azure-devops-heading"
      icon={Cloud}
    />
  );
}
