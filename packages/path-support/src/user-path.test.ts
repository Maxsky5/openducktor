import { describe, expect, test } from "bun:test";
import { normalizeUserPathInput, resolveNormalizedUserPath, resolveUserPath } from "./user-path";

describe("user path helpers", () => {
  test("normalizes whitespace and quoted empty values", () => {
    expect(normalizeUserPathInput(`  "~/project"  `)).toBe("~/project");
    expect(normalizeUserPathInput(`  '~/project'  `)).toBe("~/project");
    expect(normalizeUserPathInput(`"~/project'`)).toBe(`"~/project'`);
    expect(normalizeUserPathInput(`"   "`)).toBe("");
  });

  test("supports caller-owned home path joining", () => {
    expect(
      resolveNormalizedUserPath("~/project", {
        homeDir: "/home/dev",
        joinHomePath: (homeDir, relativePath) => `${homeDir}::${relativePath}`,
      }),
    ).toBe("/home/dev::project");
  });

  test("requires caller-owned joining for home-relative paths", () => {
    expect(() => resolveUserPath("~/project", { homeDir: "/home/dev" })).toThrow(
      "Path joining is required to resolve a home-relative path.",
    );
  });

  test("does not resolve the home directory for non-home paths", () => {
    expect(
      resolveNormalizedUserPath("./project", {
        resolveHomeDir: () => {
          throw new Error("home should not be resolved");
        },
      }),
    ).toBe("./project");
  });

  test("resolves bare home without path joining", () => {
    expect(resolveUserPath("~", { homeDir: "/home/dev" })).toBe("/home/dev");
  });
});
