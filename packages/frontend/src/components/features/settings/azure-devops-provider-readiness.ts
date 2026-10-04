export type AzureProviderReadiness = { label: string; variant: "success" | "outline" | "warning" };

export function azureProviderReadiness({
  enabled,
  hasRepository,
  hasAccount,
  ready,
}: {
  enabled: boolean;
  hasRepository: boolean;
  hasAccount: boolean;
  ready: boolean;
}): AzureProviderReadiness {
  if (!enabled) return { label: "Disabled", variant: "outline" };
  if (!hasRepository) return { label: "Link repository", variant: "warning" };
  if (!hasAccount) return { label: "Connect account", variant: "warning" };
  if (ready) return { label: "Ready", variant: "success" };
  return { label: "Check connection", variant: "warning" };
}
