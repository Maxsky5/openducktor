const HONO_ADVISORY_ID = "GHSA-xh87-mx6m-69f3";
const HONO_MIN_SAFE_VERSION = "4.12.2";

type AuditAdvisory = {
  url?: string;
};

type AuditResult = Record<string, AuditAdvisory[]>;

const decode = (buffer: Uint8Array): string => new TextDecoder().decode(buffer);
const extractFirstJsonObject = (value: string): string | null => {
  const start = value.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (!char) {
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return null;
};

const audit = Bun.spawnSync(["bun", "audit", "--json"], {
  stdout: "pipe",
  stderr: "pipe",
});

const stdout = decode(audit.stdout);
const stderr = decode(audit.stderr);
const jsonPayload = extractFirstJsonObject(stdout);

if (!jsonPayload) {
  console.error("[deps:audit:hono] Unable to parse `bun audit --json` output.");
  if (stdout.trim().length > 0) {
    console.error(stdout.trim());
  }
  if (stderr.trim().length > 0) {
    console.error(stderr.trim());
  }
  process.exit(2);
}

let parsed: AuditResult;
try {
  parsed = JSON.parse(jsonPayload) as AuditResult;
} catch (error) {
  console.error("[deps:audit:hono] Invalid JSON from `bun audit --json`.");
  console.error(error);
  process.exit(2);
}

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

if ((audit.exitCode ?? 1) !== 0) {
  console.warn(
    "[deps:audit:hono] `bun audit` reported additional advisories outside this targeted gate.",
  );
}
