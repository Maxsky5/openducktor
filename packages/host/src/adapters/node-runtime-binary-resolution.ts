import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SystemCommandPort } from "../ports/system-command-port";

const stripMatchingQuotes = (value: string): string => {
  if (value.length < 2) {
    return value;
  }
  const first = value.at(0);
  const last = value.at(-1);
  return (first === `"` && last === `"`) || (first === `'` && last === `'`)
    ? value.slice(1, -1)
    : value;
};

export const resolveUserPath = (rawPath: string): string => {
  const trimmed = stripMatchingQuotes(rawPath.trim());
  if (trimmed === "~") {
    return homedir();
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
};

export const isExecutableFile = async (candidate: string): Promise<boolean> => {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export const resolveOpencodeBinary = async (systemCommands: SystemCommandPort): Promise<string> => {
  const overrideBinary = process.env.OPENDUCKTOR_OPENCODE_BINARY;
  if (overrideBinary !== undefined) {
    if (overrideBinary.trim().length === 0) {
      throw new Error("Configured OpenCode override OPENDUCKTOR_OPENCODE_BINARY is empty");
    }
    const resolvedOverride = resolveUserPath(overrideBinary);
    if (await isExecutableFile(resolvedOverride)) {
      return resolvedOverride;
    }
    throw new Error(
      `Configured OpenCode override OPENDUCKTOR_OPENCODE_BINARY points to a missing or non-executable file: ${resolvedOverride}`,
    );
  }

  const homeCandidate = join(homedir(), ".opencode", "bin", "opencode");
  if (await isExecutableFile(homeCandidate)) {
    return homeCandidate;
  }

  const missing = await systemCommands.requiredCommandError("opencode");
  if (missing === null) {
    return "opencode";
  }

  throw new Error("opencode not found in standard install locations, PATH, or ~/.opencode/bin");
};

export const resolveCodexBinary = async (systemCommands: SystemCommandPort): Promise<string> => {
  const overrideBinary = process.env.OPENDUCKTOR_CODEX_BINARY;
  if (overrideBinary !== undefined) {
    if (overrideBinary.trim().length === 0) {
      throw new Error("Configured Codex override OPENDUCKTOR_CODEX_BINARY is empty");
    }
    const resolvedOverride = resolveUserPath(overrideBinary);
    if (await isExecutableFile(resolvedOverride)) {
      return resolvedOverride;
    }
    throw new Error(
      `Configured Codex override OPENDUCKTOR_CODEX_BINARY points to a missing or non-executable file: ${resolvedOverride}`,
    );
  }

  const missing = await systemCommands.requiredCommandError("codex");
  if (missing === null) {
    return "codex";
  }

  throw new Error("codex not found in bundled locations or PATH");
};
