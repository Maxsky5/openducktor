import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { runFixtureProcess } from "../../test-support/fixture-process";
import type {
  TestScopeProductionConfigCaseResult,
  TestScopeProductionConfigScenario,
} from "./test-support/test-scope-production-config-fixture";

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
  configScenario: z.enum(["direct", "symlink"]),
  error: z.string().nullable(),
  taskState: z.enum(["deleted", "present"]),
}) satisfies z.ZodType<TestScopeProductionConfigCaseResult>;

const resultsByScenario = new Map<
  TestScopeProductionConfigScenario,
  TestScopeProductionConfigCaseResult
>();
const fixtureHomeDirs: string[] = [];

afterAll(async () => {
  await Promise.all(
    fixtureHomeDirs.splice(0).map((homeDir) => rm(homeDir, { force: true, recursive: true })),
  );
});

beforeAll(async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "openducktor-production-guard-"));
  fixtureHomeDirs.push(homeDir);
  const stdout = await runFixtureProcess({
    args: [homeDir],
    fixtureUrl: new URL("./test-support/test-scope-production-config-fixture.ts", import.meta.url),
    homeDir,
  });
  for (const result of z.array(resultSchema).parse(JSON.parse(stdout))) {
    resultsByScenario.set(result.configScenario, result);
  }
  // The hook boots a real Bun child that exercises filesystem guards on a shared CI runner.
}, 30_000);

test.each([
  ["production root", "direct"],
  ["symlink to the production root", "symlink"],
] as const)("rejects a test-scoped %s before startup changes task-asset state", (_, scenario) => {
  const result = resultsByScenario.get(scenario);
  if (!result) {
    throw new Error(`Expected a production config guard result for the ${scenario} scenario.`);
  }

  expect(result.error).toContain(
    "Test scope refuses task asset access under the production config directory",
  );
  expect(result.after).toEqual(result.before);
  expect(result.taskState).toBe("present");
});
