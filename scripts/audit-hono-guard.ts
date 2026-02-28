import { runBunAuditJson } from "./audit-utils";

const HONO_ADVISORY_ID = "GHSA-xh87-mx6m-69f3";
const HONO_MIN_SAFE_VERSION = "4.12.2";

const { parsed, exitCode } = runBunAuditJson("[deps:audit:hono]");

const honoAdvisories = Array.isArray(parsed.hono) ? parsed.hono : [];
const hasVulnerableHono = honoAdvisories.some((advisory) => {
  return advisory.url?.includes(HONO_ADVISORY_ID);
});

if (hasVulnerableHono) {
  console.error(
    `[deps:audit:hono] ${HONO_ADVISORY_ID} detected for hono. Lockfile must resolve hono >=${HONO_MIN_SAFE_VERSION}.`,
  );
  process.exit(1);
}

console.log(`[deps:audit:hono] No ${HONO_ADVISORY_ID} advisory detected for hono.`);

if (exitCode !== 0) {
  console.warn(
    "[deps:audit:hono] `bun audit` reported additional advisories outside this targeted gate.",
  );
}
