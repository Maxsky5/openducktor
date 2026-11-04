import { describe, expect, test } from "bun:test";
import type { PullRequestReviewCheck } from "@openducktor/contracts";
import {
  checkBadgeVariant,
  checkLabel,
  checksSummaryLabel,
  ciChecksIndicatorStatus,
  isBotCommentAuthor,
} from "./task-execution-ci-presentation";

const completedCheck = (
  conclusion: PullRequestReviewCheck["conclusion"],
  name = "lint",
): PullRequestReviewCheck => ({
  name,
  workflow: "CI",
  status: "completed",
  conclusion,
  url: null,
  details: null,
  startedAt: null,
  completedAt: null,
});

describe("check presentation", () => {
  test("shows a warning check as Warning, apart from failing and passing checks", () => {
    const warning = completedCheck("warning");

    expect(checkLabel(warning)).toBe("Warning");
    expect(checkBadgeVariant(warning)).toBe("warning");
    expect(checkBadgeVariant(completedCheck("failure"))).toBe("danger");
    expect(checkBadgeVariant(completedCheck("success"))).toBe("success");
  });

  test("a warning check neither fails nor passes the check summary", () => {
    const checks = [completedCheck("success", "unit"), completedCheck("warning", "lint")];

    expect(ciChecksIndicatorStatus(checks)).toBeNull();
    expect(checksSummaryLabel(checks)).toBe("2 checks");
  });
});

describe("isBotCommentAuthor", () => {
  test("finds GitLab project, group, and service account bot users", () => {
    for (const author of [
      "project_278964_bot_7f3a9c1e2b4d",
      "group_42_bot_0a1b2c3d",
      "service_account_review",
      "service_account_group_42_reviewer",
    ]) {
      expect(isBotCommentAuthor(author)).toBe(true);
    }
  });

  test("keeps human GitLab users", () => {
    for (const author of ["project_lead", "group_42_admin", "jane.doe", "service-desk-team"]) {
      expect(isBotCommentAuthor(author)).toBe(false);
    }
  });
});
