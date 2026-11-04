import { describe, expect, test } from "bun:test";
import type { GitlabAccount } from "@openducktor/contracts";
import {
  changeGitlabInstance,
  gitlabDraftFromConfig,
  gitlabDraftErrors,
  gitlabProviderConfig,
  gitlabReadiness,
  parseGitlabDraft,
} from "./gitlab-provider-model";

const accountId = "4b0b1d5a-1c49-4f43-9f7b-5f1d2d4f0c11";
const account: GitlabAccount = {
  accountId,
  instanceUrl: "https://gitlab.com",
  userId: 1,
  username: "alice",
  displayName: "Alice",
  authKind: "token",
  tokenExpiresAt: "2026-11-08T00:00:00.000Z",
};

describe("GitLab provider model", () => {
  test("accepts a host name without a scheme and a project path with .git", () => {
    expect(
      parseGitlabDraft({
        ...gitlabDraftFromConfig(undefined),
        instanceUrl: "Code.Corp/gitlab/",
        projectPath: "/group/sub/app.git",
      }),
    ).toEqual({
      providerId: "gitlab",
      instanceUrl: "https://code.corp/gitlab",
      projectPath: "group/sub/app",
    });
    expect(
      gitlabDraftErrors({ ...gitlabDraftFromConfig(undefined), projectPath: "app" }),
    ).toHaveProperty("projectPath");
  });

  test("drops the account link and HTTP consent when the instance changes", () => {
    const draft = {
      ...gitlabDraftFromConfig(undefined),
      accountId,
      httpConsentInstanceUrl: "http://code.corp",
    };
    expect(changeGitlabInstance(draft, "https://gitlab.com/").accountId).toBe(accountId);
    expect(changeGitlabInstance(draft, "https://code.corp")).toMatchObject({
      accountId: null,
      httpConsentInstanceUrl: null,
    });
  });

  test("keeps an invalid project and its link out of the provider config", () => {
    expect(
      gitlabProviderConfig(
        { ...gitlabDraftFromConfig(undefined), accountId },
        { enabled: true, autoDetected: false },
      ),
    ).toEqual({ id: "gitlab", enabled: true, autoDetected: false });
  });

  test("shows one readiness state and warns before a token expires", () => {
    const draft = { ...gitlabDraftFromConfig(undefined), projectPath: "group/app" };
    const now = Date.parse("2026-11-03T00:00:00Z");
    expect(gitlabReadiness({ enabled: false, draft, status: null, now }).label).toBe("Disabled");
    expect(
      gitlabReadiness({ enabled: true, draft: gitlabDraftFromConfig(undefined), status: null, now })
        .label,
    ).toBe("Link project");
    expect(gitlabReadiness({ enabled: true, draft, status: null, now }).label).toBe(
      "Connect account",
    );
    const ready = gitlabReadiness({
      enabled: true,
      draft: { ...draft, accountId },
      status: { status: "ready", account, projectId: 1, projectWebUrl: "https://gitlab.com/g/a" },
      now,
    });
    expect(ready.label).toBe("Ready");
    expect(ready.warning).toContain("expires");
    expect(
      gitlabReadiness({
        enabled: true,
        draft: { ...draft, accountId },
        status: {
          status: "needs_attention",
          account,
          problem: "token_expired",
          message: "Expired.",
          actions: ["replace_token"],
          retryAfter: null,
        },
        now,
      }).label,
    ).toBe("Needs attention");
  });
});
