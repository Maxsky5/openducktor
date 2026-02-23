import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";

export const CUSTOM_STATUS_VALUES = "spec_ready,ready_for_dev,ai_review,human_review";

export const nowIso = (): string => new Date().toISOString();

const EMPTY_ENV_SENTINELS = new Set(["undefined", "null"]);

export const normalizeOptionalInput = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (EMPTY_ENV_SENTINELS.has(trimmed.toLowerCase())) {
    return undefined;
  }
  return trimmed;
};

export const sanitizeSlug = (input: string): string => {
  let slug = "";
  let lastDash = false;

  for (const char of input) {
    const lower = char.toLowerCase();
    if (/^[a-z0-9]$/.test(lower)) {
      slug += lower;
      lastDash = false;
      continue;
    }
    if (!lastDash) {
      slug += "-";
      lastDash = true;
    }
  }

  slug = slug.replace(/^-+/, "").replace(/-+$/, "");
  return slug.length > 0 ? slug : "repo";
};

export type ProcessResult = { ok: boolean; stdout: string; stderr: string };
export type ProcessRunner = (
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
) => Promise<ProcessResult>;
export type BeadsDirResolver = (repoPath: string) => Promise<string>;
export type TimeProvider = () => string;

export const runProcess: ProcessRunner = async (
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<ProcessResult> => {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      rejectPromise(error);
    });

    child.on("close", (code) => {
      resolvePromise({
        ok: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
};

export const resolveCanonicalPath = async (pathValue: string): Promise<string> => {
  const absolute = resolve(pathValue);
  try {
    return await realpath(absolute);
  } catch {
    return absolute;
  }
};

export const computeRepoId = async (repoPath: string): Promise<string> => {
  const canonical = await resolveCanonicalPath(repoPath);
  const slug = sanitizeSlug(basename(canonical));
  const digest = createHash("sha256").update(canonical).digest("hex").slice(0, 8);
  return `${slug}-${digest}`;
};

export const resolveCentralBeadsDir = async (repoPath: string): Promise<string> => {
  const repoId = await computeRepoId(repoPath);
  const root = `${homedir()}/.openducktor/beads/${repoId}`;
  await mkdir(root, { recursive: true });
  return `${root}/.beads`;
};
