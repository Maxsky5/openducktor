import { describe, expect, test } from "bun:test";
import { isMutatingPermission } from "./permission-policy";

describe("isMutatingPermission", () => {
  test("does not mark read-only bash commands as mutating", () => {
    expect(
      isMutatingPermission("bash", ["*"], {
        command: 'cat AGENTS.md && rg -n "Spec" docs -S',
      }),
    ).toBe(false);
  });

  test("marks shell write commands as mutating", () => {
    expect(
      isMutatingPermission("shell", ["*"], {
        command: "rm -rf tmp && git add .",
      }),
    ).toBe(true);
  });

  test("marks explicit mutating permissions as mutating", () => {
    expect(isMutatingPermission("write_file", ["*"])).toBe(true);
  });

  test("keeps unknown shell requests human-gated", () => {
    expect(isMutatingPermission("bash", ["*"], {})).toBe(false);
  });

  test("allows known read tools", () => {
    expect(isMutatingPermission("tool", ["*"], { tool: "read" })).toBe(false);
  });
});
