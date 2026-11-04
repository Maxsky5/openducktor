import { describe, expect, test } from "bun:test";
import { gitProviderLabel, sourceIssueLabel } from "./git-provider-label";

describe("sourceIssueLabel", () => {
  test("names the provider of each known source issue", () => {
    expect(sourceIssueLabel({ providerId: "github", number: "12" })).toBe("GitHub #12");
    expect(sourceIssueLabel({ providerId: "gitlab", number: "12" })).toBe("GitLab #12");
    expect(sourceIssueLabel({ providerId: "azure_devops", number: "12" })).toBe("Azure DevOps #12");
  });

  test("shows the ID of a provider that the client does not know", () => {
    expect(gitProviderLabel("gitea")).toBe("gitea");
    expect(gitProviderLabel("toString")).toBe("toString");
  });
});
