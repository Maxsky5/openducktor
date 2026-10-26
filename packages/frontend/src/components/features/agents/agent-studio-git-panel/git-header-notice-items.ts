import {
  type GitHeaderNoticeKey,
  gitHeaderNotices,
} from "@openducktor/frontend-core/git/model/git-panel-header";

export type HeaderNoticeItem = {
  key: GitHeaderNoticeKey;
  tone: "warning" | "error" | "muted";
  id?: string;
  testId?: string;
  children: string;
};

export const DETECT_PR_ERROR_ID = "agent-studio-git-detect-pr-error";

const NOTICE_TEST_IDS = {
  "detect-pr": DETECT_PR_ERROR_ID,
  lock: "agent-studio-git-lock-reason",
  refresh: "agent-studio-git-refresh-error",
  upstream: null,
  comparison: "agent-studio-git-comparison-unavailable",
  rebase: "agent-studio-git-rebase-error",
  push: "agent-studio-git-push-error",
} satisfies Record<GitHeaderNoticeKey, string | null>;

/** The notices under the branch row, in display order. */
export function headerNotices(input: Parameters<typeof gitHeaderNotices>[0]): HeaderNoticeItem[] {
  return gitHeaderNotices(input).map(({ key, tone, text }) => {
    const item: HeaderNoticeItem = { key, tone, children: text };
    const testId = NOTICE_TEST_IDS[key];
    if (testId) item.testId = testId;
    // Detect PR names its notice as the reason it is disabled.
    if (key === "detect-pr") item.id = DETECT_PR_ERROR_ID;
    return item;
  });
}
