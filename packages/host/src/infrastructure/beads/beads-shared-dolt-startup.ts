import { createHash } from "node:crypto";
import { mkdir, realpath, rename, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { Effect } from "effect";
import type { BeadsSharedServerPaths } from "./beads-context-model";
import {
  SHARED_DOLT_PORT_RANGE_LEN,
  SHARED_DOLT_PORT_RANGE_START,
  SHARED_DOLT_SERVER_HOST,
} from "./beads-context-model";

export const portIsAvailable = (port: number): Effect.Effect<boolean> =>
  Effect.async<boolean>((resume, signal) => {
    const server = net.createServer();
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", abort);
      server.off("error", onError);
      resume(Effect.succeed(available));
    };
    const closeThenFinish = (available: boolean): void => {
      if (server.listening) {
        server.close(() => finish(available));
        return;
      }
      finish(available);
    };
    const abort = () => closeThenFinish(false);
    const onError = () => finish(false);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    server.once("error", onError);
    try {
      server.listen(port, SHARED_DOLT_SERVER_HOST, () => closeThenFinish(true));
    } catch {
      finish(false);
    }
  });

export const deterministicSharedDoltPortCandidate = (baseDir: string): Effect.Effect<number> =>
  Effect.gen(function* () {
    const absoluteBaseDir = path.isAbsolute(baseDir) ? baseDir : path.resolve(baseDir);
    const resolvedBaseDir = yield* Effect.tryPromise(() => realpath(absoluteBaseDir)).pipe(
      Effect.catchAll(() => Effect.succeed(absoluteBaseDir)),
    );
    const digest = createHash("sha256").update(resolvedBaseDir).digest();
    const offset = digest.readUInt16BE(0) % SHARED_DOLT_PORT_RANGE_LEN;
    return SHARED_DOLT_PORT_RANGE_START + offset;
  });

export const wrapPortCandidate = (base: number, offset: number): number => {
  const normalizedBase = base - SHARED_DOLT_PORT_RANGE_START;
  return SHARED_DOLT_PORT_RANGE_START + ((normalizedBase + offset) % SHARED_DOLT_PORT_RANGE_LEN);
};

/** @internal Test-only seam for Dolt YAML config quoting. */
export const yamlQuotePath = (inputPath: string): string => `'${inputPath.replaceAll("'", "''")}'`;

export const writeDoltConfigFile = (
  paths: BeadsSharedServerPaths,
  port: number,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise(() => mkdir(paths.sharedServerRoot, { recursive: true }));
    yield* Effect.tryPromise(() => mkdir(paths.cfgDir, { recursive: true }));
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
    yield* Effect.tryPromise(() => writeFile(tempFile, config));
    yield* Effect.tryPromise(() => rename(tempFile, paths.doltConfigFile));
  });
