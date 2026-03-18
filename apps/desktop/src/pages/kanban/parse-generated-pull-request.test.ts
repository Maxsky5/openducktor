import { describe, expect, test } from "bun:test";
import { parseGeneratedPullRequest } from "./use-task-approval-flow";

describe("parseGeneratedPullRequest", () => {
  test("parses plain Title:/Description: format", () => {
    const input = `Title: Fix bug in login
Description:
## Summary
Fixed the login button issue.`;
    const result = parseGeneratedPullRequest(input);
    expect(result.title).toBe("Fix bug in login");
    expect(result.body).toBe("## Summary\nFixed the login button issue.");
  });

  test("parses content wrapped in markdown code block", () => {
    const input = `\`\`\`markdown
Title: Fix bug in login
Description:
## Summary
Fixed the login button issue.
\`\`\``;
    const result = parseGeneratedPullRequest(input);
    expect(result.title).toBe("Fix bug in login");
    expect(result.body).toBe("## Summary\nFixed the login button issue.");
  });

  test("parses content with bold Title: and Description: markers", () => {
    const input = `**Title:** Fix bug in login
**Description:**
## Summary
Fixed the login button issue.`;
    const result = parseGeneratedPullRequest(input);
    expect(result.title).toBe("Fix bug in login");
    expect(result.body).toBe("## Summary\nFixed the login button issue.");
  });

  test("parses content with bold markers and code block fences", () => {
    const input = `\`\`\`markdown
**Title:** Fix bug in login
**Description:**
## Summary
Fixed the login button issue.
\`\`\``;
    const result = parseGeneratedPullRequest(input);
    expect(result.title).toBe("Fix bug in login");
    expect(result.body).toBe("## Summary\nFixed the login button issue.");
  });

  test("parses content with leading code block fence and no language tag", () => {
    const input = `\`\`\`
Title: Fix bug in login
Description:
## Summary
Fixed the login button issue.
\`\`\``;
    const result = parseGeneratedPullRequest(input);
    expect(result.title).toBe("Fix bug in login");
    expect(result.body).toBe("## Summary\nFixed the login button issue.");
  });

  test("throws when Title: is not at position 0", () => {
    const input = `Prefix text
Title: Fix bug
Description:
Body`;
    expect(() => parseGeneratedPullRequest(input)).toThrow(
      "Generated pull request response did not match the expected format.",
    );
  });

  test("throws when Description: is missing", () => {
    const input = `Title: Fix bug
No description here`;
    expect(() => parseGeneratedPullRequest(input)).toThrow(
      "Generated pull request response did not match the expected format.",
    );
  });

  test("throws when title is empty", () => {
    const input = `Title:
Description:
Body`;
    expect(() => parseGeneratedPullRequest(input)).toThrow(
      "Generated pull request response is missing the title or description.",
    );
  });

  test("throws when body is empty", () => {
    const input = `Title: Fix bug
Description:`;
    expect(() => parseGeneratedPullRequest(input)).toThrow(
      "Generated pull request response is missing the title or description.",
    );
  });

  test("handles body with multiple markdown sections", () => {
    const input = `Title: Feature release
Description:
## Summary
This is the summary.

## Changes
- Change 1
- Change 2

## Testing
Ran all tests.`;
    const result = parseGeneratedPullRequest(input);
    expect(result.title).toBe("Feature release");
    expect(result.body).toBe(`## Summary
This is the summary.

## Changes
- Change 1
- Change 2

## Testing
Ran all tests.`);
  });
});
