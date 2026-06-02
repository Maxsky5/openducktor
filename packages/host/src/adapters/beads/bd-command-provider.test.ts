import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import type {
  BeadsCommandJsonOutput,
  RunBdJson,
} from "../../infrastructure/beads/task-store/beads-raw-issue";
import { createBdCommandProvider } from "./bd-command-provider";
import { createExistingTestBeadsCliContext, createFakeBd } from "./test-support/beads-test-support";

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
