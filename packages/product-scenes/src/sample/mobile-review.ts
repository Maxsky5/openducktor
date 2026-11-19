// The Builder session of the search shortcut task on the phone when the task waits in Human
// Review: QA approved the fix of the Builder, so every step of the workflow rail is done. The
// approval scenes of the mobile app start from this session. The commands and the times are
// fictional.
import type { RailStep } from "../replicas/mobile/MobileRail";
import type { MobileCall } from "../replicas/mobile/ToolRun";
import type { RoleId } from "../replicas/vocabulary";
import { codexCommand } from "./mobile";

/** The time of the message that starts the fix turn of the Builder. */
export const FIX_KICKOFF_TIME = "10:11:12 AM";

/** The last tool calls of the Builder before the review, in one run. */
export const FIX_TOOLS = {
  test: codexCommand("bash", "bun test src/search", "2.4s", "10:12:08 AM"),
  lint: codexCommand("bash", "bun run lint", "3.8s", "10:12:15 AM"),
  commit: codexCommand(
    "bash",
    'git commit -m "fix: keep focus in the search field"',
    "300ms",
    "10:12:21 AM",
  ),
} as const satisfies Record<string, MobileCall>;

/** The calls of the run, which is folded, because the last reply follows it. */
export const FIX_RUN = [
  "test",
  "lint",
  "commit",
] as const satisfies readonly (keyof typeof FIX_TOOLS)[];

/** The time that the fix turn took, from its first message to the last reply. */
export const FIX_WORKED = "1m13s";

/** The last reply of the Builder, after its fix for the QA review. */
export const FIX_SUMMARY =
  "The search field keeps the focus now. `bun test src/search` and `bun run lint` pass, and the fix is committed.";

/** The message of the oldest commit of the task branch, which a squash merge suggests. */
export const OLDEST_COMMIT_MESSAGE = "feat: open search with a keyboard shortcut";

/** taskApprovalSquashCommitHint for the target branch main. */
export const SQUASH_HINT = {
  before: "Edit this message before combining the branch changes into one commit on ",
  code: "main",
  after: ".",
} as const;

/** The workflow rail of a task in Human Review: every step is done. */
export const REVIEW_RAIL = {
  spec: { tone: "done", mark: "done" },
  planner: { tone: "done", mark: "done" },
  build: { tone: "done", mark: "done" },
  qa: { tone: "done", mark: "done" },
} as const satisfies Record<RoleId, RailStep>;
