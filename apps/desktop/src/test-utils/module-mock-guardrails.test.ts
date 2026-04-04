import { describe, expect, test } from "bun:test";
import path from "node:path";

const TEST_ROOT = path.resolve(import.meta.dir, "..");

const FORBIDDEN_PATTERNS = [
  {
    label: 'barrel mock for "@/state"',
    regex: /mock\.module\(["']@\/state["']/g,
  },
  {
    label: "process-wide mock.restore()",
    regex: /\bmock\.restore\(/g,
  },
];

describe("desktop test module mock guardrails", () => {
  test("desktop tests avoid fragile barrel mocks, process-wide restore, and leaked module mocks", async () => {
    const violations: string[] = [];
    const glob = new Bun.Glob("**/*.test.{ts,tsx}");

    for await (const relativePath of glob.scan({ cwd: TEST_ROOT })) {
      if (relativePath === "test-utils/module-mock-guardrails.test.ts") {
        continue;
      }

      const filePath = path.join(TEST_ROOT, relativePath);
      const content = await Bun.file(filePath).text();

      for (const pattern of FORBIDDEN_PATTERNS) {
        pattern.regex.lastIndex = 0;
        if (!pattern.regex.test(content)) {
          continue;
        }

        violations.push(`${path.relative(process.cwd(), filePath)}: ${pattern.label}`);
      }

      if (content.includes("mock.module(") && !content.includes("restoreMockedModules(")) {
        violations.push(
          `${path.relative(process.cwd(), filePath)}: module mocks must restore exact modules with restoreMockedModules`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
