// The sample data of the PR comments scene: the comments of pull request 42 in the CI Checks tab,
// the times of the two reads of the tab, and the Builder turn that applies the suggestion. The
// review thread holds the diff hunk that GitHub gives for a new file: every line from the start of
// the file to the line of the comment. The names, the times, and the coverage are fictional.
// Sources: threads.ts and suggestions.ts in packages/host/src/adapters/git-providers/github/review.
import type { CiComment } from "../../replicas/studio/comments";
import { HOOK_PATH, REVIEWED_HOOK_LINES } from "../../sample/studio";
import { TASK_BRANCH } from "../../sample/worktree";

export const PR_NUMBER = 42;

/** The times of the two reads of the tab: before the push of the Builder, and after it. */
export const NOW = { first: "2026-11-08T10:40:12Z", last: "2026-11-08T10:47:30Z" } as const;
export const UPDATED = { first: "10:40:12 AM", last: "10:47:30 AM" } as const;

/** The line of the comment: the check for an open dialog. */
const LINE = 14;
const COMMENTED = REVIEWED_HOOK_LINES[LINE - 1] ?? "";
const COMPOSING_CHECK = "      if (event.isComposing) return;";

/** The suggestion block of the comment, as the reviewer writes it on GitHub. */
const REPLACEMENT = `${COMMENTED}\n${COMPOSING_CHECK}`;
const THREAD_TEXT = "Skip the shortcut while an input method composes text.";

/** The body of the thread comment that GitHub sends, with its suggestion block. */
export const THREAD_SOURCE = {
  body: `${THREAD_TEXT}\n\n\`\`\`suggestion\n${REPLACEMENT}\n\`\`\``,
  line: LINE,
};

/** The diff hunk of the thread: the hook is a new file, so the hunk starts at line 1. */
export const THREAD_HUNK = [
  `@@ -0,0 +1,${REVIEWED_HOOK_LINES.length} @@`,
  ...REVIEWED_HOOK_LINES.slice(0, LINE).map((line) => `+${line}`),
].join("\n");

/** The suggested change of the thread, as formatSuggestionPatch writes it. */
export const SUGGESTION = [
  `@@ -${LINE},1 +${LINE},2 @@`,
  `-${COMMENTED}`,
  `+${COMMENTED}`,
  `+${COMPOSING_CHECK}`,
].join("\n");

/** The review that comes after the push. The first read does not have it. */
export const APPROVAL = "approval";

/** The comments of the last read, newest first. */
export const COMMENTS: readonly CiComment[] = [
  {
    id: APPROVAL,
    source: "review",
    author: "maya",
    bot: false,
    outcome: "approved",
    createdAt: "2026-11-08T10:46:58Z",
    body: "",
    resolved: null,
  },
  {
    id: "review",
    source: "review",
    author: "maya",
    bot: false,
    outcome: "changes_requested",
    createdAt: "2026-11-08T10:32:10Z",
    body: "Two small things before merge.",
    resolved: null,
  },
  {
    id: "thread",
    source: "review_thread",
    author: "maya",
    bot: false,
    createdAt: "2026-11-08T10:31:40Z",
    body: THREAD_TEXT,
    patch: THREAD_HUNK,
    suggestions: [SUGGESTION],
    path: HOOK_PATH,
    line: LINE,
    resolved: false,
  },
  {
    id: "coverage",
    source: "comment",
    author: "codecov",
    bot: true,
    createdAt: "2026-11-08T10:30:40Z",
    body: "Project coverage is 92.4% (+0.6%). All changed lines are covered by tests.",
    resolved: null,
  },
  {
    id: "shell",
    source: "review_thread",
    author: "maya",
    bot: false,
    createdAt: "2026-11-08T10:30:15Z",
    body: "Register the shortcut once, here in the shell.",
    path: "src/app/app-shell.tsx",
    line: 8,
    resolved: true,
  },
];

/** The message that the visitor sends to the Builder. */
export const ASK = "Apply maya's suggestion in use-search-shortcut.ts and push.";

/** The rows of the turn before the comments, and of the turn that applies the suggestion. */
export const ROWS = {
  create: {
    args: 'gh pr create --base main --title "feat(search): open search from anywhere with Cmd+K"',
    duration: "1.9s",
    time: "10:24:40 AM",
  },
  watch: { args: `gh pr checks ${PR_NUMBER} --watch`, duration: "1m 52s", time: "10:27:43 AM" },
  commit: {
    args: 'git commit -am "fix(search): skip the shortcut while text composes"',
    duration: "0.3s",
    time: "10:43:41 AM",
  },
  push: { args: `git push origin ${TASK_BRANCH}`, duration: "1.2s", time: "10:43:44 AM" },
} as const;

/** The final reply of the turn that published the pull request. */
export const READY =
  "Pull request #42 is ready. All 4 required checks pass: lint, typecheck, test, and build.";

/** The reply of the Builder after the push. */
export const APPLIED = "I applied the suggestion of maya on line 14 and pushed the fix.";
