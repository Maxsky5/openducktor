import { describe, expect, test } from "bun:test";
import { isHostLoadedIssueImageUrl } from "./issue-image-url";

const GITLAB_SECRET = "0123456789abcdef0123456789abcdef";

describe("isHostLoadedIssueImageUrl", () => {
  test("accepts a GitHub user attachment image", () => {
    expect(
      isHostLoadedIssueImageUrl(
        "github",
        "https://github.com/user-attachments/assets/0f3c2a5e-1b2c-4d5e-8f90-123456789abc",
      ),
    ).toBe(true);
  });

  test("rejects other GitHub image addresses", () => {
    expect(isHostLoadedIssueImageUrl("github", "https://example.com/image.png")).toBe(false);
    expect(
      isHostLoadedIssueImageUrl("github", "https://github.com/user-attachments/assets/short"),
    ).toBe(false);
    expect(
      isHostLoadedIssueImageUrl(
        "github",
        `https://gitlab.com/group/project/uploads/${GITLAB_SECRET}/image.png`,
      ),
    ).toBe(false);
  });

  test("accepts GitLab project uploads by project path and by project ID", () => {
    for (const url of [
      `https://gitlab.com/group/project/uploads/${GITLAB_SECRET}/image.png`,
      `https://gitlab.example.com/group/subgroup/project/uploads/${GITLAB_SECRET}/screen%20shot.png`,
      `https://gitlab.example.com/-/project/42/uploads/${GITLAB_SECRET}/image.png`,
      `http://gitlab.internal/gitlab/group/project/uploads/${GITLAB_SECRET}/image.png`,
    ]) {
      expect(isHostLoadedIssueImageUrl("gitlab", url)).toBe(true);
    }
  });

  test("rejects other GitLab image addresses", () => {
    for (const url of [
      "https://gitlab.com/group/project/uploads/short/image.png",
      `https://gitlab.com/group/project/uploads/${GITLAB_SECRET}/`,
      `https://gitlab.com/group/project/uploads/${GITLAB_SECRET}/nested/image.png`,
      `https://gitlab.com/group/project/uploads/${GITLAB_SECRET}/image.png?x=1`,
      `/group/project/uploads/${GITLAB_SECRET}/image.png`,
      "https://example.com/image.png",
      "https://github.com/user-attachments/assets/0f3c2a5e-1b2c-4d5e-8f90-123456789abc",
    ]) {
      expect(isHostLoadedIssueImageUrl("gitlab", url)).toBe(false);
    }
  });

  test("loads no Azure DevOps image through the host", () => {
    expect(
      isHostLoadedIssueImageUrl(
        "azure_devops",
        `https://dev.azure.com/org/project/uploads/${GITLAB_SECRET}/image.png`,
      ),
    ).toBe(false);
  });
});
