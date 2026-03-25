import { runBunAuditJson } from "./audit-utils";

const HONO_ADVISORY_IDS = ["GHSA-xh87-mx6m-69f3", "GHSA-v8w9-8mx6-g223"] as const;
const HONO_MIN_SAFE_VERSION = "4.12.7";

const { parsed, exitCode } = runBunAuditJson("[deps:audit:hono]");

const honoAdvisories = Array.isArray(parsed.hono) ? parsed.hono : [];
const detectedAdvisoryIds = HONO_ADVISORY_IDS.filter((advisoryId) => {
  const advisoryIdLower = advisoryId.toLowerCase();
  return honoAdvisories.some((advisory) => {
    const advisoryUrl = advisory.url?.trim().toLowerCase() ?? "";
    return advisoryUrl.includes(advisoryIdLower);
  });
});

if (detectedAdvisoryIds.length > 0) {
  console.error(
    `[deps:audit:hono] Advisory detected for hono: ${detectedAdvisoryIds.join(
      ", ",
    )}. Lockfile must resolve hono >=${HONO_MIN_SAFE_VERSION}.`,
  );
  process.exit(1);
}

if (exitCode !== 0) {
  console.warn(
    "[deps:audit:hono] `bun audit` reported additional advisories outside this targeted gate.",
  );
}
