type DiagnosticsSummary = {
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
  hasCriticalIssues,
  hasSetupIssues,
}: {
  hasActiveRepo: boolean;
  hasCriticalIssues: boolean;
  hasSetupIssues: boolean;
}): DiagnosticsSummary => {
  if (!hasActiveRepo) {
    return {
      label: "No repository selected",
      toneClass: "text-slate-500",
      iconClass: "text-slate-500",
    };
  }

  if (hasCriticalIssues) {
    return {
      label: "Critical issue",
      toneClass: "text-rose-700",
      iconClass: "text-rose-600",
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
