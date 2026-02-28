import { runBunAuditJson } from "./audit-utils";

const HIGH_SEVERITY_LEVELS = new Set(["high", "critical"]);

const { parsed } = runBunAuditJson("[deps:audit:high]");

const blockingAdvisories = Object.entries(parsed).flatMap(([pkg, advisories]) => {
  if (!Array.isArray(advisories)) {
    return [];
  }

  return advisories
    .filter((advisory) => {
      const severity = advisory.severity?.toLowerCase();
      return Boolean(severity) && HIGH_SEVERITY_LEVELS.has(severity);
    })
    .map((advisory) => ({ pkg, advisory }));
});

if (blockingAdvisories.length > 0) {
  console.error(
    `[deps:audit:high] Found ${blockingAdvisories.length} high/critical advisory item(s).`,
  );
  for (const { pkg, advisory } of blockingAdvisories) {
    const severity = advisory.severity?.toUpperCase() ?? "UNKNOWN";
    const title = advisory.title ?? "(no title)";
    const url = advisory.url ?? "(no advisory URL)";
    const range = advisory.vulnerable_versions ?? "(no vulnerable range provided)";
    console.error(`[deps:audit:high] ${severity} ${pkg}: ${title}`);
    console.error(`[deps:audit:high] advisory=${url} vulnerable=${range}`);
  }
  process.exit(1);
}

console.log("[deps:audit:high] No high/critical advisories detected.");
