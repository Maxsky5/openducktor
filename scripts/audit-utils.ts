import { z } from "zod";

export type AuditAdvisory = {
  title?: string;
  url?: string;
  severity?: string;
  vulnerable_versions?: string;
};

export type AuditResult = Record<string, AuditAdvisory[]>;

export type AuditReporter = {
  error: (message: string) => void;
  warn: (message: string) => void;
};

type BunAuditProcessResult = {
  exitedDueToTimeout?: boolean;
  exitCode: number | null;
  stderr: string;
  stdout: string;
};

type BunAuditProcessRunner = (timeoutMs: number) => BunAuditProcessResult;

const auditAdvisorySchema = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  severity: z.string().optional(),
  vulnerable_versions: z.string().optional(),
});

const auditResultSchema = z.record(z.string(), z.array(auditAdvisorySchema));

export type BunAuditJsonResult = {
  parsed: AuditResult;
  exitCode: number;
};

const BUN_AUDIT_TIMEOUT_MS = 30_000;

const decode = (buffer: Uint8Array): string => new TextDecoder().decode(buffer);

const runBunAuditProcess: BunAuditProcessRunner = (timeoutMs) => {
  const audit = Bun.spawnSync(["bun", "audit", "--json"], {
    stderr: "pipe",
    stdout: "pipe",
    timeout: timeoutMs,
    windowsHide: true,
  });

  return {
    exitedDueToTimeout: audit.exitedDueToTimeout,
    exitCode: audit.exitCode,
    stderr: decode(audit.stderr),
    stdout: decode(audit.stdout),
  };
};

class BunAuditCommandError extends Error {
  readonly stderr: string;
  readonly stdout: string;

  constructor(
    message: string,
    { cause, stderr = "", stdout = "" }: { cause?: unknown; stderr?: string; stdout?: string } = {},
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "BunAuditCommandError";
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

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

export const runBunAuditJson = (
  prefix: string,
  runAudit: BunAuditProcessRunner = runBunAuditProcess,
): BunAuditJsonResult => {
  let audit: BunAuditProcessResult;
  try {
    audit = runAudit(BUN_AUDIT_TIMEOUT_MS);
  } catch (error) {
    throw new BunAuditCommandError(`${prefix} Failed to start \`bun audit --json\`.`, {
      cause: error,
    });
  }
  const { stderr, stdout } = audit;

  if (audit.exitedDueToTimeout) {
    throw new BunAuditCommandError(`${prefix} \`bun audit --json\` timed out after 30 seconds.`, {
      stderr,
      stdout,
    });
  }

  const jsonPayload = extractFirstJsonObject(stdout);

  if (!jsonPayload) {
    throw new BunAuditCommandError(`${prefix} \`bun audit --json\` failed before returning JSON.`, {
      stderr,
      stdout,
    });
  }

  try {
    return {
      parsed: auditResultSchema.parse(JSON.parse(jsonPayload)),
      exitCode: audit.exitCode ?? 1,
    };
  } catch (error) {
    throw new BunAuditCommandError(`${prefix} Invalid JSON from \`bun audit --json\`.`, {
      cause: error,
      stderr,
      stdout,
    });
  }
};

export const runBunAuditCli = (run: () => number, reporter: AuditReporter = console): void => {
  try {
    process.exitCode = run();
  } catch (error) {
    if (!(error instanceof BunAuditCommandError)) {
      throw error;
    }
    reporter.error(error.message);
    if (error.stdout.trim().length > 0) {
      reporter.error(error.stdout.trim());
    }
    if (error.stderr.trim().length > 0) {
      reporter.error(error.stderr.trim());
    }
    process.exitCode = 2;
  }
};
