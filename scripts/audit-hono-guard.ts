import {
  runBunAuditCli,
  runBunAuditJson,
  type AuditReporter,
  type AuditResult,
} from "./audit-utils";

const HONO_ADVISORY_IDS = ["GHSA-xh87-mx6m-69f3", "GHSA-v8w9-8mx6-g223"] as const;
const HONO_MIN_SAFE_VERSION = "4.12.7";

export const checkHonoAdvisories = (
  parsed: AuditResult,
  exitCode: number,
  reporter: AuditReporter = console,
): number => {
  const honoAdvisories = parsed.hono ?? [];
  const detectedAdvisoryIds = HONO_ADVISORY_IDS.filter((advisoryId) => {
    const advisoryIdLower = advisoryId.toLowerCase();
    return honoAdvisories.some((advisory) => {
      const advisoryUrl = advisory.url?.trim().toLowerCase() ?? "";
      return advisoryUrl.includes(advisoryIdLower);
    });
  });

  if (detectedAdvisoryIds.length > 0) {
    reporter.error(
      `[deps:audit:hono] Advisory detected for hono: ${detectedAdvisoryIds.join(
        ", ",
      )}. Lockfile must resolve hono >=${HONO_MIN_SAFE_VERSION}.`,
    );
    return 1;
  }

  if (exitCode !== 0) {
    reporter.warn(
      "[deps:audit:hono] `bun audit` reported additional advisories outside this targeted gate.",
    );
  }

  return 0;
};

if (import.meta.main) {
  runBunAuditCli(() => {
    const { parsed, exitCode } = runBunAuditJson("[deps:audit:hono]");
    return checkHonoAdvisories(parsed, exitCode);
  });
}
