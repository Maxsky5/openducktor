import { describe, expect, test } from "bun:test";
import { isGithubIssueAttachmentUrl } from "./issue-image-url";

describe("isGithubIssueAttachmentUrl", () => {
  test("accepts a GitHub user attachment image", () => {
    expect(
      isGithubIssueAttachmentUrl(
        "https://github.com/user-attachments/assets/0f3c2a5e-1b2c-4d5e-8f90-123456789abc",
      ),
    ).toBe(true);
  });

  test("rejects other image addresses", () => {
    expect(isGithubIssueAttachmentUrl("https://example.com/image.png")).toBe(false);
    expect(isGithubIssueAttachmentUrl("https://github.com/user-attachments/assets/short")).toBe(
      false,
    );
  });
});
