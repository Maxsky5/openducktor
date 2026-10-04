export type DiagnosticsSummary = {
  label: string;
  toneClass: string;
  iconClass: string;
};

/** Priority: blocking failure, then loading, then setup warning. */
export const buildDiagnosticsSummary = ({
  isChecking,
  hasCriticalIssues,
  hasSetupIssues,
}: {
  isChecking: boolean;
  hasCriticalIssues: boolean;
  hasSetupIssues: boolean;
}): DiagnosticsSummary => {
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
