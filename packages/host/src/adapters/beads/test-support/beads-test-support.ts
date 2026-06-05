import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import { createToolDiscoveryAdapter } from "../../system/tool-discovery";
import type { BeadsSharedServerContext } from "../beads-cli-context";

export const createTestToolDiscoveryPort = (missingCommands: string[] = []) =>
  createToolDiscoveryAdapter({
    systemCommands: {
      resolveCommandPath: (command) =>
        Effect.succeed(missingCommands.includes(command) ? null : command),
      runCommandAllowFailure: () => Effect.succeed({ ok: false, stdout: "", stderr: "" }),
      versionCommand: () => Effect.succeed(null),
    },
  });

export const createTestBeadsCliContext = (
  beadsDir: string,
  bdPath = "bd",
): BeadsSharedServerContext => ({
  repoPath: "/repo",
  repoId: "repo-12345678",
  databaseName: "odt_repo_123456789abc",
  attachmentRoot: path.dirname(beadsDir),
  beadsDir,
  workingDir: path.dirname(beadsDir),
  serverStatePath: "/config/beads/shared-server/server.json",
  sharedServer: {
    pid: process.pid,
    host: "127.0.0.1",
    port: 36000,
    user: "root",
    ownerPid: process.pid,
    acquisition: "started_by_owner",
    sharedServerRoot: "/config/beads/shared-server",
    doltDataDir: "/config/beads/shared-server/dolt",
    startedAt: "2026-05-10T00:00:00Z",
  },
  env: {
    ...(process.env.PATH === undefined ? {} : { PATH: process.env.PATH }),
    BEADS_DIR: beadsDir,
    BEADS_DOLT_SERVER_MODE: "1",
    BEADS_DOLT_SERVER_HOST: "127.0.0.1",
    BEADS_DOLT_SERVER_PORT: "36000",
    BEADS_DOLT_SERVER_USER: "root",
  },
  tools: {
    beads: bdPath,
  },
  sharedDoltTools: {
    dolt: "dolt",
    selectedDoltVersion: "2.1.2",
  },
});

export const createExistingTestBeadsCliContext = async ({
  bdPath = "bd",
  prefix = "odt-beads-test-",
}: {
  bdPath?: string;
  prefix?: string;
} = {}): Promise<BeadsSharedServerContext> => {
  const attachmentRoot = await mkdtemp(path.join(tmpdir(), prefix));
  const beadsDir = path.join(attachmentRoot, ".beads");
  await mkdir(beadsDir);
  return createTestBeadsCliContext(beadsDir, bdPath);
};

export const createFakeBd = async (binDir: string, script: string): Promise<string> => {
  const scriptPath = path.join(binDir, "bd.mjs");
  await writeFile(scriptPath, script);
  if (process.platform === "win32") {
    const bdPath = path.join(binDir, "bd.cmd");
    await writeFile(bdPath, `@echo off\r\nbun "%~dp0bd.mjs" %*\r\n`);
    return bdPath;
  }
  const bdPath = path.join(binDir, "bd");
  await writeFile(bdPath, `#!/bin/sh\nexec bun "$(dirname "$0")/bd.mjs" "$@"\n`);
  await chmod(bdPath, 0o755);
  return bdPath;
};

export const createFakeDolt = async (binDir: string, version = "2.1.2"): Promise<string> => {
  if (process.platform === "win32") {
    const doltPath = path.join(binDir, "dolt.cmd");
    await writeFile(
      doltPath,
      [
        "@echo off",
        'if "%1"=="version" (',
        `  echo dolt version ${version}`,
        "  exit /b 0",
        ")",
        "exit /b 1",
        "",
      ].join("\r\n"),
    );
    return doltPath;
  }

  const doltPath = path.join(binDir, "dolt");
  await writeFile(
    doltPath,
    `#!/bin/sh
if [ "$1" = "version" ]; then
  echo "dolt version ${version}"
  exit 0
fi
exit 1
`,
  );
  await chmod(doltPath, 0o755);
  return doltPath;
};

export const testOperationError = (cause: unknown) =>
  new HostOperationError({
    operation: "test.effect",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
