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
  TASK_BRANCH,
  TASK_ID,
  TEST_PATH,
} from "./studio";
import { signature } from "./sessions";

type ToolKind = "read" | "search" | "bash" | "tool";
export type Answer = { prompt: string; answer: string };

/** One transcript row. Each kind has the component of its product source. */
export type Row =
  | { kind: "user"; id: string; time: string; text: string }
  | {
      kind: "tool";
      id: string;
      tool: ToolKind;
      name: string;
      args: string;
      duration: string;
      time: string;
      answers?: readonly Answer[];
    }
  | { kind: "workflow"; id: string; name: string; duration: string; time: string }
  | { kind: "patch"; id: string; path: string; change: "A" | "M"; add: number; del: number }
  | { kind: "agent"; id: string; signature: string; paragraphs: readonly string[] };

type ToolRow = Extract<Row, { kind: "tool" }>;

function tool<Id extends string>(
  id: Id,
  kind: ToolKind,
  name: string,
  args: string,
  duration: string,
  time: string,
): ToolRow & { id: Id } {
  return { kind: "tool", id, tool: kind, name, args, duration, time };
}

function readTask(duration: string, time: string) {
  return tool("read-task", "tool", "read_task", TASK_ID, duration, time);
}

function bash<Id extends string>(id: Id, args: string, duration: string, time: string) {
  return tool(id, "bash", "Bash", args, duration, time);
}

function read<Id extends string>(id: Id, args: string, duration: string, time: string) {
  return tool(id, "read", "Read", args, duration, time);
}

function search(args: string, duration: string, time: string) {
  return tool("search", "search", "Search", args, duration, time);
}

export const TURNS = {
  spec: [
    { kind: "user", id: "kickoff", time: "09:41:12 AM", text: KICKOFF.spec },
    readTask("184ms", "09:41:14 AM"),
    search("openSearch in src", "96ms", "09:41:17 AM"),
    read("read-dialog", "src/search/search-dialog.tsx", "12ms", "09:41:19 AM"),
    {
      kind: "tool",
      id: "question",
      tool: "tool",
      name: "Question",
      args: "Which shortcut opens search?",
      duration: "38s",
      time: "09:41:22 AM",
      answers: [
        { prompt: "Which shortcut opens search?", answer: "Cmd+K / Ctrl+K" },
        {
          prompt: "Should the shortcut work while typing in a text field?",
          answer: "No, ignore it in text fields",
        },
      ],
    },
    { kind: "workflow", id: "set-spec", name: "set_spec", duration: "41ms", time: "09:42:03 AM" },
    {
      kind: "agent",
      id: "final",
      signature: signature(SPEC_SESSION),
      paragraphs: [
        "I saved the specification with your answers: `Cmd+K` on macOS, `Ctrl+K` on Windows and Linux, and no shortcut in text fields or in the note editor.",
        "I added one rule: the shortcut does nothing while another dialog is open. `search-dialog.tsx` traps focus, and two open dialogs would compete for it.",
      ],
    },
  ],
  plan: [
    { kind: "user", id: "kickoff", time: "09:44:05 AM", text: KICKOFF.planner },
    readTask("142ms", "09:44:07 AM"),
    search("keydown in src", "88ms", "09:44:10 AM"),
    read("read-shell", "src/app/app-shell.tsx", "9ms", "09:44:12 AM"),
    read("read-keymap", "src/app/keymap.ts", "7ms", "09:44:13 AM"),
    read("read-dialog", "src/search/search-dialog.tsx", "11ms", "09:44:15 AM"),
    { kind: "workflow", id: "set-plan", name: "set_plan", duration: "52ms", time: "09:45:31 AM" },
    {
      kind: "agent",
      id: "final",
      signature: signature(PLANNER_SESSION),
      paragraphs: [
        "I saved the plan. A new hook, `use-search-shortcut.ts`, opens the existing search dialog, and the app shell mounts it once.",
        "`src/app/keymap.ts` already binds `Cmd+Shift+K`, so the hook ignores `Shift`.",
      ],
    },
  ],
  build: [
    { kind: "user", id: "kickoff", time: "09:46:30 AM", text: KICKOFF.build },
    readTask("131ms", "09:46:32 AM"),
    read("read-guide", "AGENTS.md", "6ms", "09:46:35 AM"),
    ...BUILD_FILES.map((file, index) => ({
      kind: "patch" as const,
      id: `patch-${index}` as const,
      path: file.path,
      change: file.type === "added" ? ("A" as const) : ("M" as const),
      add: file.add,
      del: file.del,
    })),
    bash("test", "bun test src/search", "2.4s", "09:48:51 AM"),
    bash("commit", 'git commit -m "feat(search): open search with Cmd+K"', "0.3s", "09:49:02 AM"),
    {
      kind: "workflow",
      id: "completed",
      name: "build_completed",
      duration: "38ms",
      time: "09:49:05 AM",
    },
    {
      kind: "agent",
      id: "final",
      signature: signature(BUILDER_SESSION),
      paragraphs: [
        "I committed the change on the task branch. `bun test src/search`: 5 tests pass.",
        "The hook opens search with `Cmd+K` on macOS and `Ctrl+K` elsewhere. It does nothing with `Shift`, in text fields, or in the note editor.",
      ],
    },
  ],
  qa: [
    { kind: "user", id: "kickoff", time: "09:51:40 AM", text: KICKOFF.qa },
    readTask("120ms", "09:51:42 AM"),
    read("read-hook", HOOK_PATH, "8ms", "09:51:45 AM"),
    bash("test", "bun test src/search", "2.3s", "09:51:49 AM"),
    search("aria-modal in src", "74ms", "09:51:55 AM"),
    {
      kind: "workflow",
      id: "rejected",
      name: "qa_rejected",
      duration: "45ms",
      time: "09:52:48 AM",
    },
    {
      kind: "agent",
      id: "final",
      signature: signature(QA_SESSION),
      paragraphs: [
        "Rejected. The spec says the shortcut does nothing while another dialog is open. With the settings dialog open, `Cmd+K` still opens search on top of it.",
        "The hook checks text fields but not open dialogs, and no test covers the case. The rest matches the spec.",
      ],
    },
  ],
  fix: [
    { kind: "user", id: "kickoff", time: "09:54:02 AM", text: KICKOFF.fix },
    readTask("118ms", "09:54:04 AM"),
    { kind: "patch", id: "hook", path: HOOK_PATH, change: "M", add: 1, del: 0 },
    { kind: "patch", id: "test", path: TEST_PATH, change: "M", add: 12, del: 0 },
    bash("run", "bun test src/search", "2.5s", "09:55:12 AM"),
    bash(
      "commit",
      'git commit -m "fix(search): keep search closed while a dialog is open"',
      "0.3s",
      "09:55:20 AM",
    ),
    {
      kind: "workflow",
      id: "completed",
      name: "build_completed",
      duration: "36ms",
      time: "09:55:23 AM",
    },
    {
      kind: "agent",
      id: "final",
      signature: signature(BUILDER_SESSION),
      paragraphs: [
        "The finding holds. The hook now returns early while a modal dialog is open, and a new test opens the settings dialog and presses `Cmd+K`.",
        "`bun test src/search`: 6 tests pass.",
      ],
    },
  ],
  review: [
    { kind: "user", id: "comment", time: "10:21:40 AM", text: REVIEW_MESSAGE },
    { kind: "patch", id: "hook", path: HOOK_PATH, change: "M", add: 1, del: 1 },
    { kind: "patch", id: "test", path: TEST_PATH, change: "M", add: 11, del: 0 },
    bash("run", "bun test src/search", "2.4s", "10:22:31 AM"),
    bash(
      "commit",
      'git commit -m "fix(search): leave a handled Cmd+K alone"',
      "0.3s",
      "10:22:38 AM",
    ),
    {
      kind: "agent",
      id: "final",
      signature: signature(BUILDER_FIX_SESSION),
      paragraphs: [
        "Done. The hook now returns early when `event.defaultPrevented` is true, and a new test covers it. `bun test src/search`: 7 tests pass.",
      ],
    },
  ],
  pr: [
    { kind: "user", id: "kickoff", time: "10:24:05 AM", text: KICKOFF.pullRequest },
    bash("fetch", "git fetch origin main", "0.9s", "10:24:09 AM"),
    bash("checks", "bun run lint && bun test", "6.1s", "10:24:16 AM"),
    bash("push", `git push -u origin ${TASK_BRANCH}`, "1.4s", "10:24:31 AM"),
    bash("create", `gh pr create --base main --title "${PR_TITLE}"`, "1.9s", "10:24:40 AM"),
    {
      kind: "workflow",
      id: "set",
      name: "set_pull_request",
      duration: "52ms",
      time: "10:24:44 AM",
    },
    bash("watch", "gh pr checks 42 --watch", "1m 48s", "10:24:47 AM"),
    {
      kind: "agent",
      id: "final",
      signature: signature(BUILDER_PR_SESSION),
      paragraphs: [
        "Pull request #42 is open against `main`: https://github.com/fieldnotes/fieldnotes/pull/42.",
        "Local checks passed: `bun run lint` and `bun test`. Pull request checks passed: lint, typecheck, test, and build.",
      ],
    },
  ],
} as const satisfies Record<string, readonly Row[]>;

export type TurnId = keyof typeof TURNS;

/** The sessions of the story, with their turns in order. */
export const SESSIONS = {
  spec: ["spec"],
  planner: ["plan"],
  qa: ["qa"],
  build: ["build", "fix", "review", "pr"],
} as const satisfies Record<string, readonly TurnId[]>;

export type SessionId = keyof typeof SESSIONS;

/** The row ids of a turn, for the scene that plays it. */
export type RowId<Turn extends TurnId> = (typeof TURNS)[Turn][number]["id"];
