import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import type {
  BeadsCommandJsonOutput,
  RunBd,
  RunBdJson,
} from "../../infrastructure/beads/task-store/beads-raw-issue";
import { createBdCommandProvider } from "./bd-command-provider";
import { createExistingTestBeadsCliContext, createFakeBd } from "./test-support/beads-test-support";

const bdContextEchoScript = `console.log(JSON.stringify({
  args: process.argv.slice(2),
  beadsDir: process.env.BEADS_DIR,
  doltServerPort: process.env.BEADS_DOLT_SERVER_PORT
}));\n`;

const withFakeBd = async <T>(
  script: string,
  runTest: (bdPath: string) => Promise<T>,
): Promise<T> => {
  const binDir = await mkdtemp(path.join(tmpdir(), "odt-fake-bd-bin-"));
  try {
    const bdPath = await createFakeBd(binDir, script);
    const result = await runTest(bdPath);
    return result;
  } finally {
    await rm(binDir, { recursive: true, force: true });
  }
};

describe("createBdCommandProvider", () => {
  test("binds default JSON runners to one prepared shared-server context per repo operation", async () => {
    await withFakeBd(bdContextEchoScript, async (bdPath) => {
      const context = await createExistingTestBeadsCliContext({
        bdPath,
        prefix: "odt-bd-provider-test-",
      });
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
  });

  test("binds default non-JSON runners to one prepared shared-server context per repo operation", async () => {
    await withFakeBd(bdContextEchoScript, async (bdPath) => {
      const context = await createExistingTestBeadsCliContext({
        bdPath,
        prefix: "odt-bd-provider-test-",
      });
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

      const runBdForOperation = await Effect.runPromise(provider.runBdForRepo("/repo"));
      const first = JSON.parse(
        await Effect.runPromise(runBdForOperation("/repo", ["delete", "task-1"])),
      );
      const second = JSON.parse(
        await Effect.runPromise(runBdForOperation("/repo", ["delete", "--force", "task-2"])),
      );

      expect(contextRequests).toEqual([{ repoPath: "/repo", requireSharedServer: true }]);
      expect(first).toMatchObject({
        args: ["delete", "task-1"],
        beadsDir: context.beadsDir,
        doltServerPort: "36000",
      });
      expect(second).toMatchObject({
        args: ["delete", "--force", "task-2"],
        beadsDir: context.beadsDir,
        doltServerPort: "36000",
      });
    });
  });

  test("uses configured non-JSON runners without pre-resolving a context", async () => {
    const context = await createExistingTestBeadsCliContext({
      prefix: "odt-bd-provider-test-",
    });
    let contextResolved = false;
    const configuredRunBd: RunBd = (repoPath, args, callContext) =>
      Effect.succeed(
        JSON.stringify({
          args,
          hasContext: callContext !== undefined,
          repoPath,
        }),
      );
    const provider = createBdCommandProvider({
      runBd: configuredRunBd,
      resolveCliContext() {
        contextResolved = true;
        return Effect.succeed(context);
      },
    });

    const runBdForOperation = await Effect.runPromise(provider.runBdForRepo("/repo"));
    const output = JSON.parse(
      await Effect.runPromise(runBdForOperation("/repo", ["delete", "task-1"])),
    );

    expect(contextResolved).toBe(false);
    expect(output).toEqual({
      args: ["delete", "task-1"],
      hasContext: false,
      repoPath: "/repo",
    });
  });

  test("uses configured JSON runners without pre-resolving a context", async () => {
    const context = await createExistingTestBeadsCliContext({
      prefix: "odt-bd-provider-test-",
    });
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
