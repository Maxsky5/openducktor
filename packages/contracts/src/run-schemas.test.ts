import { describe, expect, test } from "bun:test";
import {
  runtimeExecutableCheckInputSchema,
  runtimeExecutableCheckSchema,
  runtimeHealthSchema,
} from "./run-schemas";

describe("run schemas", () => {
  test("keeps executable paths separate from runtime versions", () => {
    expect(
      runtimeHealthSchema.parse({
        kind: "codex",
        ok: true,
        executablePath: "/opt/codex/bin/codex",
        version: "codex 1.2.3",
        error: null,
      }),
    ).toMatchObject({
      executablePath: "/opt/codex/bin/codex",
      version: "codex 1.2.3",
    });
  });

  test("accepts discover and exact-path validation inputs", () => {
    expect(runtimeExecutableCheckInputSchema.parse({ mode: "discover" })).toEqual({
      mode: "discover",
    });
    expect(
      runtimeExecutableCheckInputSchema.parse({
        mode: "validate",
        paths: { opencode: "/bin/opencode", codex: "", claude: "/bin/claude" },
      }),
    ).toMatchObject({ mode: "validate" });
  });

  test("accepts a focused exact-path validation input and rejects an empty request", () => {
    expect(
      runtimeExecutableCheckInputSchema.parse({
        mode: "validate",
        paths: { codex: "/bin/codex" },
      }),
    ).toEqual({ mode: "validate", paths: { codex: "/bin/codex" } });

    expect(
      runtimeExecutableCheckInputSchema.safeParse({ mode: "validate", paths: {} }).success,
    ).toBe(false);
  });

  test("requires one explicit path on every executable check row", () => {
    const result = runtimeExecutableCheckSchema.safeParse({
      runtimes: [{ kind: "opencode", ok: false, version: null, error: "missing" }],
    });

    expect(result.success).toBe(false);
  });
});
