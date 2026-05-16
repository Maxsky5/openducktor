import { createHash } from "node:crypto";
import { mkdir, realpath, rename, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import type { BeadsSharedServerPaths } from "./beads-context-model";
import {
  SHARED_DOLT_PORT_RANGE_LEN,
  SHARED_DOLT_PORT_RANGE_START,
  SHARED_DOLT_SERVER_HOST,
} from "./beads-context-model";

export const portIsAvailable = async (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, SHARED_DOLT_SERVER_HOST, () => {
      server.close(() => resolve(true));
    });
  });

export const deterministicSharedDoltPortCandidate = async (baseDir: string): Promise<number> => {
  let resolvedBaseDir = path.isAbsolute(baseDir) ? baseDir : path.resolve(baseDir);
  try {
    resolvedBaseDir = await realpath(resolvedBaseDir);
  } catch {
    // The config dir may not exist yet; use its absolute spelling, matching Rust's canonical-or-absolute behavior.
  }
  const digest = createHash("sha256").update(resolvedBaseDir).digest();
  const offset = digest.readUInt16BE(0) % SHARED_DOLT_PORT_RANGE_LEN;
  return SHARED_DOLT_PORT_RANGE_START + offset;
};

export const wrapPortCandidate = (base: number, offset: number): number => {
  const normalizedBase = base - SHARED_DOLT_PORT_RANGE_START;
  return SHARED_DOLT_PORT_RANGE_START + ((normalizedBase + offset) % SHARED_DOLT_PORT_RANGE_LEN);
};

export const yamlQuotePath = (inputPath: string): string => `'${inputPath.replaceAll("'", "''")}'`;

export const writeDoltConfigFile = async (
  paths: BeadsSharedServerPaths,
  port: number,
): Promise<void> => {
  await mkdir(paths.sharedServerRoot, { recursive: true });
  await mkdir(paths.cfgDir, { recursive: true });
  const privilegeFile = path.join(paths.cfgDir, "privileges.db");
  const branchControlFile = path.join(paths.cfgDir, "branch_control.db");
  const config =
    `log_level: info\n` +
    `behavior:\n` +
    `  autocommit: true\n` +
    `listener:\n` +
    `  host: ${SHARED_DOLT_SERVER_HOST}\n` +
    `  port: ${port}\n` +
    `data_dir: ${yamlQuotePath(paths.doltRoot)}\n` +
    `cfg_dir: ${yamlQuotePath(paths.cfgDir)}\n` +
    `privilege_file: ${yamlQuotePath(privilegeFile)}\n` +
    `branch_control_file: ${yamlQuotePath(branchControlFile)}\n`;
  const tempFile = `${paths.doltConfigFile}.tmp-${process.pid}`;
  await writeFile(tempFile, config);
  await rename(tempFile, paths.doltConfigFile);
};
