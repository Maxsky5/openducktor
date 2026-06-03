export type DiagnosticsSummary = {
  label: string;
  toneClass: string;
  iconClass: string;
};

export const buildDiagnosticsSummary = ({
  hasActiveWorkspace,
  isChecking,
  hasCriticalIssues,
  hasPendingRuntimeStartup,
  hasSetupIssues,
}: {
  hasActiveWorkspace: boolean;
  isChecking: boolean;
  hasCriticalIssues: boolean;
  hasPendingRuntimeStartup?: boolean;
  hasSetupIssues: boolean;
}): DiagnosticsSummary => {
  if (!hasActiveWorkspace) {
    return {
      label: "No repository selected",
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

  if (isChecking) {
    return {
      label: "Checking...",
      toneClass: "text-muted-foreground",
      iconClass: "text-muted-foreground",
    };
  }

  if (hasPendingRuntimeStartup) {
    return {
      label: "Runtime not started",
      toneClass: "text-warning-muted",
      iconClass: "text-warning-accent",
    };
  }

  if (hasSetupIssues) {
    return {
      label: "Setup needed",
      toneClass: "text-warning-muted",
      iconClass: "text-warning-accent",
    };
  }

  return {
    label: "Healthy",
    toneClass: "text-success-muted",
    iconClass: "text-success-accent",
  };
};
