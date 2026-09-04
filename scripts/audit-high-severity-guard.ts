import {
  runBunAuditCli,
  runBunAuditJson,
  type AuditReporter,
  type AuditResult,
} from "./audit-utils";

const HIGH_SEVERITY_LEVELS = new Set(["high", "critical"]);

export const checkHighSeverityAdvisories = (
  parsed: AuditResult,
  reporter: AuditReporter = console,
): number => {
  const blockingAdvisories = Object.entries(parsed).flatMap(([pkg, advisories]) =>
    advisories
      .filter((advisory) => {
        const severity = advisory.severity?.toLowerCase();
        return Boolean(severity) && HIGH_SEVERITY_LEVELS.has(severity);
      })
      .map((advisory) => ({ pkg, advisory })),
  );

  if (blockingAdvisories.length === 0) {
    return 0;
  }

  reporter.error(
    `[deps:audit:high] Found ${blockingAdvisories.length} high/critical advisory item(s).`,
  );
  for (const { pkg, advisory } of blockingAdvisories) {
    const severity = advisory.severity?.toUpperCase() ?? "UNKNOWN";
    const title = advisory.title ?? "(no title)";
    const url = advisory.url ?? "(no advisory URL)";
    const range = advisory.vulnerable_versions ?? "(no vulnerable range provided)";
    reporter.error(`[deps:audit:high] ${severity} ${pkg}: ${title}`);
    reporter.error(`[deps:audit:high] advisory=${url} vulnerable=${range}`);
  }

  return 1;
};

if (import.meta.main) {
  runBunAuditCli(() => {
    const { parsed } = runBunAuditJson("[deps:audit:high]");
    return checkHighSeverityAdvisories(parsed);
  });
}
