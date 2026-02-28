export type AuditAdvisory = {
  title?: string;
  url?: string;
  severity?: string;
  vulnerable_versions?: string;
};

export type AuditResult = Record<string, AuditAdvisory[]>;

type BunAuditJsonResult = {
  parsed: AuditResult;
  exitCode: number;
};

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

export const runBunAuditJson = (prefix: string): BunAuditJsonResult => {
  const audit = Bun.spawnSync(["bun", "audit", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = decode(audit.stdout);
  const stderr = decode(audit.stderr);
  const jsonPayload = extractFirstJsonObject(stdout);

  if (!jsonPayload) {
    console.error(`${prefix} Unable to parse \`bun audit --json\` output.`);
    if (stdout.trim().length > 0) {
      console.error(stdout.trim());
    }
    if (stderr.trim().length > 0) {
      console.error(stderr.trim());
    }
    process.exit(2);
  }

  try {
    return {
      parsed: JSON.parse(jsonPayload) as AuditResult,
      exitCode: audit.exitCode ?? 1,
    };
  } catch (error) {
    console.error(`${prefix} Invalid JSON from \`bun audit --json\`.`);
    console.error(error);
    process.exit(2);
  }
};
