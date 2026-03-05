import { describe, expect, test } from "bun:test";
import { toRepositorySelectorOptions } from "./repository-selector-model";

describe("toRepositorySelectorOptions", () => {
  test("maps repository paths to combobox options using repository name labels", () => {
    const options = toRepositorySelectorOptions([
      "/Users/dev/workspace/openducktor",
      "/Users/dev/workspace/fairnest",
    ]);

    expect(options).toEqual([
      {
        value: "/Users/dev/workspace/openducktor",
        label: "openducktor",
        searchKeywords: ["Users", "dev", "workspace", "openducktor"],
      },
      {
        value: "/Users/dev/workspace/fairnest",
        label: "fairnest",
        searchKeywords: ["Users", "dev", "workspace", "fairnest"],
      },
    ]);
  });

  test("adds error metadata when repository prompt validation reports errors", () => {
    const options = toRepositorySelectorOptions(
      ["/Users/dev/workspace/openducktor", "/Users/dev/workspace/fairnest"],
      {
        "/Users/dev/workspace/fairnest": 2,
      },
    );

    expect(options).toEqual([
      {
        value: "/Users/dev/workspace/openducktor",
        label: "openducktor",
        searchKeywords: ["Users", "dev", "workspace", "openducktor"],
      },
      {
        value: "/Users/dev/workspace/fairnest",
        label: "fairnest",
        searchKeywords: ["Users", "dev", "workspace", "fairnest"],
        accentColor: "hsl(var(--destructive))",
        secondaryLabel: "2 errors",
      },
    ]);
  });
});
