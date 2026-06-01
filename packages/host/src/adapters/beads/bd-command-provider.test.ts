import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { delimiter } from "node:path";
import { Effect } from "effect";
import type {
  BeadsCommandJsonOutput,
  RunBdJson,
} from "../../infrastructure/beads/task-store/beads-raw-issue";
import { createBdCommandProvider } from "./bd-command-provider";
import type { BeadsSharedServerContext } from "./beads-cli-context";

const TEST_SHARED_DOLT_TOOL_PATHS = {
  dolt: "dolt",
};

const createBeadsCliContext = (beadsDir: string, bdPath = "bd"): BeadsSharedServerContext => ({
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
    BEADS_DIR: beadsDir,
    BEADS_DOLT_SERVER_MODE: "1",
    BEADS_DOLT_SERVER_HOST: "127.0.0.1",
    BEADS_DOLT_SERVER_PORT: "36000",
    BEADS_DOLT_SERVER_USER: "root",
  },
  tools: {
    beads: bdPath,
  },
  sharedDoltTools: TEST_SHARED_DOLT_TOOL_PATHS,
});

const createExistingBeadsCliContext = async (bdPath = "bd"): Promise<BeadsSharedServerContext> => {
  const attachmentRoot = await mkdtemp(path.join(tmpdir(), "odt-bd-provider-test-"));
  const beadsDir = path.join(attachmentRoot, ".beads");
  await mkdir(beadsDir);
  return createBeadsCliContext(beadsDir, bdPath);
};

const createFakeBd = async (binDir: string, script: string): Promise<string> => {
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

describe("createBdCommandProvider", () => {
  test("binds default JSON runners to one prepared shared-server context per repo operation", async () => {
    const binDir = await mkdtemp(path.join(tmpdir(), "odt-fake-bd-bin-"));
    const bdPath = await createFakeBd(
      binDir,
      `console.log(JSON.stringify({
  args: process.argv.slice(2),
  beadsDir: process.env.BEADS_DIR,
  doltServerPort: process.env.BEADS_DOLT_SERVER_PORT
}));\n`,
    );
    const context = await createExistingBeadsCliContext(bdPath);
    context.env.PATH = `${binDir}${delimiter}${process.env.PATH ?? ""}`;
    const contextRequests: Array<{
      repoPath: string;
      requireSharedServer: boolean | undefined;
    }> = [];
    const provider = createBdCommandProvider({
      resolveCliContext(repoPath, options) {
        return Effect.sync(() => {
          contextRequests.push({
            repoPath,
            requireSharedServer: options?.requireSharedServer,
          });
          return context;
        });
      },
    });

    const runBdJsonForOperation = await Effect.runPromise(provider.runBdJsonForRepo("/repo"));
    const first = await Effect.runPromise(runBdJsonForOperation("/repo", ["where"]));
    const second = await Effect.runPromise(runBdJsonForOperation("/repo", ["status"]));

    expect(contextRequests).toEqual([{ repoPath: "/repo", requireSharedServer: true }]);
    expect(first).toMatchObject({
      args: ["where", "--json"],
      beadsDir: context.beadsDir,
      doltServerPort: "36000",
    });
    expect(second).toMatchObject({
      args: ["status", "--json"],
      beadsDir: context.beadsDir,
      doltServerPort: "36000",
    });
  });

  test("uses configured JSON runners without pre-resolving a context", async () => {
    const context = await createExistingBeadsCliContext();
    let contextResolved = false;
    const configuredRunBdJson: RunBdJson = (repoPath, args, callContext) =>
      Effect.succeed({
        args,
        hasContext: callContext !== undefined,
        repoPath,
      });
    const provider = createBdCommandProvider({
      runBdJson: configuredRunBdJson,
      resolveCliContext() {
        contextResolved = true;
        return Effect.succeed(context);
      },
    });

    const runBdJsonForOperation = await Effect.runPromise(provider.runBdJsonForRepo("/repo"));
    const output: BeadsCommandJsonOutput = await Effect.runPromise(
      runBdJsonForOperation("/repo", ["list"]),
    );

    expect(contextResolved).toBe(false);
    expect(output).toEqual({
      args: ["list"],
      hasContext: false,
      repoPath: "/repo",
    });
  });
});
