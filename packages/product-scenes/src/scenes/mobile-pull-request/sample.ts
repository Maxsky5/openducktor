// The sample data of the Pull Request scene of the mobile app. QA approved the search shortcut
// task, so the task waits in Human Review, and its Builder session is open. The Git provider
// creates pull requests, so Approve Task opens on Pull request, and the draft that the Builder
// writes is the first choice. The pull request launch of the built-in workflow continues or forks a
// session of the Builder, and it continues the latest one first. The Builder session then gets the
// pull request prompt. Its last turn ran the lint and the tests of the search, so the Builder runs
// the whole test suite once, pushes the branch, and opens pull request 42. It saves the pull request
// on the task with odt_set_pull_request and reports it. The repository of the sample requires no
// pull request check, so the Builder waits for none. The clock times follow the steps of the scene,
// and the commands and the remote are fictional.
import type { StartModes } from "../../replicas/mobile/StartSessionSheet";
import type { MobileCall } from "../../replicas/mobile/ToolRun";
import type { RoleId } from "../../replicas/vocabulary";
import type { RailStep } from "../../replicas/mobile/MobileRail";
import { codexCommand } from "../../sample/mobile";
import { PR_TITLE } from "../../sample/studio";
import { TASKS } from "../../sample/tasks";

export const TASK = "k3x9" as const;
export const TITLE = TASKS[TASK].title;

/** The steps of the step list, one for each part of the scene. */
export const STEPS = [
  "Open the Builder session of a task in Human Review.",
  "Tap the zap button, then Approve Task.",
  "The sheet opens on Pull request, with Ask Builder chosen. Tap Choose Builder session.",
  "Reuse existing continues the latest Builder session. Tap Start session.",
  "The Builder publishes the branch, opens the pull request, and adds it to the task.",
] as const;

/** The default target branch of the repository, as the branch picker names it. */
export const TARGET = "origin/main";

/** The effort levels of the model, in the order of the track. */
export const EFFORTS = ["low", "medium", "high", "xhigh"] as const;

/**
 * The start modes of the pull request launch, as session-start-display.ts orders them. A reuse of
 * the latest Builder session is the default. Its option has the label of the first Builder session
 * of the task, as formatAgentSessionOptionLabel names it.
 */
export const START_MODES = {
  modes: ["reuse", "fork"],
  selected: "reuse",
  source: "Builder #1",
} as const satisfies StartModes;

/** The time of the pull request prompt that the reused session gets. */
export const REQUEST_TIME = "10:14:05 AM";

/** The body of the pull request that the Builder writes, in the command that creates it. */
const PULL_REQUEST_BODY = [
  "## Problem",
  "Search opens only from the toolbar, so keyboard users must leave the keyboard to search.",
  "",
  "## Change",
  "- `useSearchShortcut` opens search on Cmd+K, and on Ctrl+K on Windows and Linux.",
  "- The shortcut does nothing in a text field or while a dialog is open.",
  "",
  "## Checks",
  "- `bun run lint`",
  "- `bun test`",
].join("\n");

/** The pull request that the Builder opens on the remote of the repository of sam. */
export const PULL_REQUEST = {
  number: 42,
  title: PR_TITLE,
  url: "https://github.com/sam/fieldnotes/pull/42",
} as const;

/**
 * The tool calls of the pull request turn, in one run. The Builder runs on Codex, so each call is a
 * shell command.
 */
export const TOOLS = {
  suite: codexCommand("bash", "bun test", "2.2s", "10:14:07 AM"),
  push: codexCommand("bash", "git push -u origin HEAD", "1.1s", "10:14:10 AM"),
  create: codexCommand(
    "bash",
    [
      "gh pr create \\",
      "  --base main \\",
      `  --title "${PULL_REQUEST.title}" \\`,
      "  --body-file - <<'EOF'",
      PULL_REQUEST_BODY,
      "EOF",
    ].join("\n"),
    "1.6s",
    "10:14:11 AM",
  ),
} as const satisfies Record<string, MobileCall>;

/** The tool run of the turn. The message after it folds it. */
export const RUNS = {
  publish: ["suite", "push", "create"],
} as const satisfies Record<string, readonly (keyof typeof TOOLS)[]>;

/** The messages of the Builder during the turn: before its commands, and after the pull request. */
export const NOTES = {
  plan: "I run the tests, then push the branch and open the pull request against `main`.",
  save: `I add pull request #${PULL_REQUEST.number} to the task.`,
} as const;

/** The call of odt_set_pull_request, which saves the pull request on the task. */
export const SET_PULL_REQUEST = {
  title: "Set Pull Request",
  duration: "2.1s",
  time: "10:14:15 AM",
} as const;

/** The time that the turn took, from the prompt to the last reply. */
export const WORKED = "13s";

/**
 * The last reply of the Builder: the address of the pull request first, then the checks. Its first
 * line is short, so a viewer reads it at once.
 */
export const REPORT = [
  `Pull request #${PULL_REQUEST.number} is open: ${PULL_REQUEST.url}`,
  "`bun test` passes, and `main` requires no pull request check.",
] as const;

/**
 * The workflow rail while the Builder works on the pull request: the Builder step shows its
 * working session, and the connector before it takes its tone.
 */
export const WORKING_RAIL = {
  spec: { tone: "done", mark: "done" },
  planner: { tone: "done", mark: "done" },
  build: { tone: "in_progress", mark: "working" },
  qa: { tone: "done", mark: "done" },
} as const satisfies Record<RoleId, RailStep>;
