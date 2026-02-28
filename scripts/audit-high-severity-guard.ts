const HIGH_SEVERITY_LEVELS = new Set(["high", "critical"]);

type AuditAdvisory = {
  title?: string;
  url?: string;
  severity?: string;
  vulnerable_versions?: string;
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
  console.error("[deps:audit:high] Unable to parse `bun audit --json` output.");
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
  console.error("[deps:audit:high] Invalid JSON from `bun audit --json`.");
  console.error(error);
  process.exit(2);
}

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
