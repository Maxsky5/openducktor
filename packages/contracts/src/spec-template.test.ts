import { describe, expect, test } from "bun:test";
import { defaultSpecTemplateMarkdown, missingSpecSections, validateSpecMarkdown } from "./index";

describe("spec template validation", () => {
  test("default template contains all required sections", () => {
    const result = validateSpecMarkdown(defaultSpecTemplateMarkdown);
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  test("missing section is reported", () => {
    const markdown = "# Purpose\nA\n\n# Problem\nB\n\n# Goals\nC";
    const missing = missingSpecSections(markdown);
    expect(missing).toContain("Non-goals");
    expect(missing).toContain("Test Plan");
  });
});
