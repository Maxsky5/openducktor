// The session transcripts of the workflow story. A session has one turn for each prompt, and the
// Builder session keeps its turns from the build to the pull request. Inline code is in
// backticks, as the compact Markdown of the product renders it.
import {
  BUILD_FILES,
  BUILDER_FIX_SESSION,
  BUILDER_PR_SESSION,
  BUILDER_SESSION,
  HOOK_PATH,
  KICKOFF,
  PLANNER_SESSION,
  PR_TITLE,
  QA_SESSION,
  REVIEW_MESSAGE,
  SPEC_SESSION,
  TASK_ID,
  TEST_PATH,
} from "./studio";
import { signature } from "./sessions";
import { TASK_BRANCH } from "./worktree";
import type { Row, SessionData } from "../replicas/transcript/model";
import { bash, catFile, edit, readTask } from "./calls";

/** A search of Codex with a shell command. */
function search(pattern: string, duration: string, time: string) {
  return bash("search", `rg -n "${pattern}" src`, duration, time, "search");
}

/** The times of the edits of the build, in the order of BUILD_FILES. */
const BUILD_EDIT_TIMES = ["09:47:10 AM", "09:47:31 AM", "09:47:58 AM", "09:48:24 AM"];

/**
 * The calls of the build turn until the tests: the Builder reads the task and the guide, edits
 * each file of BUILD_FILES, and runs the tests.
 */
export const BUILD_CALLS = [
  readTask(TASK_ID, "131ms", "09:46:32 AM"),
  catFile("read-guide", "AGENTS.md", "6ms", "09:46:35 AM"),
  ...BUILD_FILES.map((file, index) => {
    const time = BUILD_EDIT_TIMES[index];
    if (!time) throw new Error(`The build has no edit time for ${file.path}.`);
    return edit(
      `patch-${index}` as const,
      file.path,
      { add: file.add, del: file.del },
      "41ms",
      time,
    );
  }),
  bash("test", "bun test src/search", "2.4s", "09:48:51 AM"),
];

const TURNS = {
  spec: [
    { kind: "user", id: "kickoff", time: "09:41:12 AM", text: KICKOFF.spec },
    readTask(TASK_ID, "184ms", "09:41:14 AM"),
    search("openSearch", "96ms", "09:41:17 AM"),
    catFile("read-dialog", "src/search/search-dialog.tsx", "12ms", "09:41:19 AM"),
    {
      kind: "question",
      id: "question",
      summary: "2 questions",
      answers: [
        { label: "Shortcut", answer: "Cmd+K / Ctrl+K" },
        { label: "Text fields", answer: "No, ignore it in text fields" },
      ],
      duration: "38s",
      time: "09:41:22 AM",
    },
    {
      kind: "workflow",
      id: "set-spec",
      title: "Set Spec",
      icon: "document",
      duration: "41ms",
      time: "09:42:03 AM",
    },
    {
      kind: "agent",
      id: "final",
      signature: signature(SPEC_SESSION),
      worked: "54s",
      paragraphs: [
        "I saved the specification with your answers: `Cmd+K` on macOS, `Ctrl+K` on Windows and Linux, and no shortcut in text fields or in the note editor.",
        "I added one rule: the shortcut does nothing while another dialog is open. `search-dialog.tsx` traps focus, and two open dialogs would compete for it.",
      ],
    },
  ],
  plan: [
    { kind: "user", id: "kickoff", time: "09:44:05 AM", text: KICKOFF.planner },
    readTask(TASK_ID, "142ms", "09:44:07 AM"),
    search("keydown", "88ms", "09:44:10 AM"),
    catFile("read-shell", "src/app/app-shell.tsx", "9ms", "09:44:12 AM"),
    catFile("read-keymap", "src/app/keymap.ts", "7ms", "09:44:13 AM"),
    catFile("read-dialog", "src/search/search-dialog.tsx", "11ms", "09:44:15 AM"),
    {
      kind: "workflow",
      id: "set-plan",
      title: "Set Plan",
      icon: "document",
      duration: "52ms",
      time: "09:45:31 AM",
    },
    {
      kind: "agent",
      id: "final",
      signature: signature(PLANNER_SESSION),
      worked: "1m8s",
      paragraphs: [
        "I saved the plan. A new shortcut hook opens the existing search dialog, and the app shell mounts it once. The diagram shows the flow, and the tables map each requirement to the design.",
        "`src/app/keymap.ts` already binds `Cmd+Shift+K`, so the hook ignores `Shift`.",
      ],
    },
  ],
  build: [
    { kind: "user", id: "kickoff", time: "09:46:30 AM", text: KICKOFF.build },
    ...BUILD_CALLS,
    bash("commit", 'git commit -m "feat(search): open search with Cmd+K"', "312ms", "09:49:02 AM"),
    {
      kind: "workflow",
      id: "completed",
      title: "Build Completed",
      icon: "workflow",
      duration: "38ms",
      time: "09:49:05 AM",
    },
    {
      kind: "agent",
      id: "final",
      signature: signature(BUILDER_SESSION),
      worked: "3m12s",
      paragraphs: [
        "I committed the change on the task branch. `bun test src/search`: 5 tests pass.",
        "The hook opens search with `Cmd+K` on macOS and `Ctrl+K` elsewhere. It does nothing with `Shift`, in text fields, or in the note editor.",
      ],
    },
  ],
  qa: [
    { kind: "user", id: "kickoff", time: "09:51:40 AM", text: KICKOFF.qa },
    readTask(TASK_ID, "120ms", "09:51:42 AM"),
    catFile("read-hook", HOOK_PATH, "8ms", "09:51:45 AM"),
    bash("test", "bun test src/search", "2.3s", "09:51:49 AM"),
    search("aria-modal", "74ms", "09:51:55 AM"),
    {
      kind: "workflow",
      id: "rejected",
      title: "Reject QA",
      icon: "review_failed",
      duration: "45ms",
      time: "09:52:48 AM",
    },
    {
      kind: "agent",
      id: "final",
      signature: signature(QA_SESSION),
      worked: "1m53s",
      paragraphs: [
        "Rejected. The spec says the shortcut does nothing while another dialog is open. With the settings dialog open, `Cmd+K` still opens search on top of it.",
        "The hook checks text fields but not open dialogs, and no test covers the case. The rest matches the spec.",
      ],
    },
  ],
  fix: [
    { kind: "user", id: "kickoff", time: "09:54:02 AM", text: KICKOFF.fix },
    readTask(TASK_ID, "118ms", "09:54:04 AM"),
    edit("hook", HOOK_PATH, { add: 1, del: 0 }, "36ms", "09:54:31 AM"),
    edit("test", TEST_PATH, { add: 12, del: 0 }, "39ms", "09:54:52 AM"),
    bash("run", "bun test src/search", "2.5s", "09:55:12 AM"),
    bash(
      "commit",
      'git commit -m "fix(search): keep search closed while a dialog is open"',
      "312ms",
      "09:55:20 AM",
    ),
    {
      kind: "workflow",
      id: "completed",
      title: "Build Completed",
      icon: "workflow",
      duration: "36ms",
      time: "09:55:23 AM",
    },
    {
      kind: "agent",
      id: "final",
      signature: signature(BUILDER_SESSION),
      worked: "1m41s",
      paragraphs: [
        "The finding holds. The hook now returns early while a modal dialog is open, and a new test opens the settings dialog and presses `Cmd+K`.",
        "`bun test src/search`: 6 tests pass.",
      ],
    },
  ],
  review: [
    { kind: "user", id: "comment", time: "10:21:40 AM", text: REVIEW_MESSAGE },
    edit("hook", HOOK_PATH, { add: 1, del: 1 }, "34ms", "10:22:02 AM"),
    edit("test", TEST_PATH, { add: 11, del: 0 }, "37ms", "10:22:19 AM"),
    bash("run", "bun test src/search", "2.4s", "10:22:31 AM"),
    bash(
      "commit",
      'git commit -m "fix(search): leave a handled Cmd+K alone"',
      "312ms",
      "10:22:38 AM",
    ),
    {
      kind: "agent",
      id: "final",
      signature: signature(BUILDER_FIX_SESSION),
      worked: "47s",
      paragraphs: [
        "Done. The hook now returns early when `event.defaultPrevented` is true, and a new test covers it. `bun test src/search`: 7 tests pass.",
      ],
    },
  ],
  pr: [
    { kind: "user", id: "kickoff", time: "10:24:05 AM", text: KICKOFF.pullRequest },
    bash("fetch", "git fetch origin main", "870ms", "10:24:09 AM"),
    bash("checks", "bun run lint && bun test", "6.1s", "10:24:16 AM"),
    bash("push", `git push -u origin ${TASK_BRANCH}`, "1.4s", "10:24:31 AM"),
    bash("create", `gh pr create --base main --title "${PR_TITLE}"`, "1.9s", "10:24:40 AM"),
    {
      kind: "workflow",
      id: "set",
      title: "Set Pull Request",
      icon: "pull_request",
      pr: 42,
      duration: "52ms",
      time: "10:24:44 AM",
    },
    bash("watch", "gh pr checks 42 --watch", "1m48s", "10:24:47 AM"),
    {
      kind: "agent",
      id: "final",
      signature: signature(BUILDER_PR_SESSION),
      worked: "2m36s",
      paragraphs: [
        "Pull request #42 is open against `main`: https://github.com/fieldnotes/fieldnotes/pull/42.",
        "Local checks passed: `bun run lint` and `bun test`. Pull request checks passed: lint, typecheck, test, and build.",
      ],
    },
  ],
} as const satisfies Record<string, readonly Row[]>;

type TurnId = keyof typeof TURNS;

/** The sessions of the story, with their turns in order. */
const SESSIONS = {
  spec: ["spec"],
  planner: ["plan"],
  qa: ["qa"],
  build: ["build", "fix", "review", "pr"],
} as const satisfies Record<string, readonly TurnId[]>;

export type SessionId = keyof typeof SESSIONS;

/** The row ids of a turn, for the scene that plays it. */
export type RowId<Turn extends TurnId> = (typeof TURNS)[Turn][number]["id"];

/**
 * The sessions of a transcript: each session of the story with its first `turns` turns, for the
 * `Transcript` replica.
 */
export function storySessions(
  sessions: readonly { id: SessionId; turns: number }[],
): SessionData[] {
  return sessions.map(({ id, turns }) => ({
    id,
    turns: SESSIONS[id].slice(0, turns).map((turn) => ({ id: turn, rows: TURNS[turn] })),
  }));
}
