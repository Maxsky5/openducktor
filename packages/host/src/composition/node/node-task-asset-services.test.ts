import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { TestScopeProductionConfigResult } from "./test-support/test-scope-production-config-fixture";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

const resultSchema = z.object({
  after: z.object({
    durableBytes: z.array(z.number()).nullable(),
    ownerEntries: z.array(z.string()),
    quarantineEntries: z.array(z.string()),
    stagingBytes: z.array(z.number()).nullable(),
  }),
  before: z.object({
    durableBytes: z.array(z.number()).nullable(),
    ownerEntries: z.array(z.string()),
    quarantineEntries: z.array(z.string()),
    stagingBytes: z.array(z.number()).nullable(),
  }),
  error: z.string().nullable(),
  taskState: z.enum(["deleted", "present"]),
}) satisfies z.ZodType<TestScopeProductionConfigResult>;

test.each([
  ["production root", "direct"],
  ["symlink to the production root", "symlink"],
] as const)(
  "rejects a test-scoped %s before startup changes task-asset state",
  async (_, scenario) => {
    const temporaryHome = await mkdtemp(path.join(tmpdir(), "openducktor-production-guard-"));
    roots.push(temporaryHome);
    const environment: NodeJS.ProcessEnv = { ...process.env, HOME: temporaryHome };
    delete environment.OPENDUCKTOR_CONFIG_DIR;
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        fileURLToPath(
          new URL("./test-support/test-scope-production-config-fixture.ts", import.meta.url),
        ),
        scenario,
      ],
      env: environment,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stderr, stdout] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ]);

    expect(exitCode, stderr).toBe(0);
    const result = resultSchema.parse(JSON.parse(stdout));
    expect(result.error).toContain(
      "Test scope refuses task asset access under the production config directory",
    );
    expect(result.after).toEqual(result.before);
    expect(result.taskState).toBe("present");
  },
);
