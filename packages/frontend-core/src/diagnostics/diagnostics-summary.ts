export type DiagnosticsSummaryTone = "critical" | "checking" | "setup" | "healthy";

/** The one-line verdict of the checks. Each client maps the tone to its own colors. */
export type DiagnosticsSummary = {
  label: string;
  tone: DiagnosticsSummaryTone;
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
    return { label: "Critical issue", tone: "critical" };
  }

  if (isChecking) {
    return { label: "Checking...", tone: "checking" };
  }

  if (hasSetupIssues) {
    return { label: "Setup needed", tone: "setup" };
  }

  return { label: "Healthy", tone: "healthy" };
};
