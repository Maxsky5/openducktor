import { describe, expect, test } from "bun:test";
import path from "node:path";

const SOURCE_DIRECTORIES = [
  path.resolve(import.meta.dir, ".."),
  path.resolve(import.meta.dir, "../../../../pages/agents"),
  path.resolve(import.meta.dir, "../../../../components/features/agents/agent-chat"),
];

const FORBIDDEN_PATTERNS = [
  {
    label: "direct session.messages find/findIndex",
    regex: /\.messages\.find(?:Index)?\(/g,
  },
  {
    label: "reverse-find over messages arrays",
    regex: /messages[^\n]{0,80}\.reverse\(\)\.find\(/g,
  },
];

describe("session message guardrails", () => {
  test("production code uses centralized message lookups", async () => {
    const violations: string[] = [];

    for (const directory of SOURCE_DIRECTORIES) {
      const glob = new Bun.Glob("**/*.{ts,tsx}");
      for await (const relativePath of glob.scan({ cwd: directory })) {
        if (relativePath.includes(".test.")) {
          continue;
        }

        const filePath = path.join(directory, relativePath);
        const content = await Bun.file(filePath).text();
        for (const pattern of FORBIDDEN_PATTERNS) {
          pattern.regex.lastIndex = 0;
          if (!pattern.regex.test(content)) {
            continue;
          }
          violations.push(`${path.relative(process.cwd(), filePath)}: ${pattern.label}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
