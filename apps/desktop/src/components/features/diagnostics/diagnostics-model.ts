export type DiagnosticsSummary = {
  label: string;
  toneClass: string;
  iconClass: string;
};

export const healthVariant = (
  healthy: boolean | null,
): "success" | "warning" | "danger" | "secondary" => {
  if (healthy === null) {
    return "secondary";
  }
  return healthy ? "success" : "danger";
};

export const buildDiagnosticsSummary = ({
  hasActiveRepo,
  isChecking,
  hasCriticalIssues,
  hasSetupIssues,
}: {
  hasActiveRepo: boolean;
  isChecking: boolean;
  hasCriticalIssues: boolean;
  hasSetupIssues: boolean;
}): DiagnosticsSummary => {
  if (!hasActiveRepo) {
    return {
      label: "No repository selected",
      toneClass: "text-muted-foreground",
      iconClass: "text-muted-foreground",
    };
  }

  if (isChecking) {
    return {
      label: "Checking...",
      toneClass: "text-muted-foreground",
      iconClass: "text-muted-foreground",
    };
  }

  if (hasCriticalIssues) {
    return {
      label: "Critical issue",
      toneClass: "text-destructive-muted",
      iconClass: "text-destructive-accent",
    };
  }

  if (hasSetupIssues) {
    return {
      label: "Setup needed",
      toneClass: "text-amber-700",
      iconClass: "text-amber-600",
    };
  }

  return {
    label: "Healthy",
    toneClass: "text-emerald-700",
    iconClass: "text-emerald-600",
  };
};
