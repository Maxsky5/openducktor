// The sample data of the Git conflict scene: the commits of the task branch before and after the
// rebase, the conflict of the rebase, the message that Resolve conflicts sends, and the Builder
// rows that resolve it. The commits and the output are fictional. Sources: conflict-copy.ts in
// packages/frontend-core/src/git/conflicts, and GIT_CONFLICT_INSTRUCTIONS and
// messages.build_git_conflict in packages/workflows/src/builtin/spec-plan-build/prompt-templates.ts.
import type { GitCounts } from "../../replicas/studio/GitHeader";
import { TARGET_BRANCH } from "../../replicas/studio/GitHeader";
import { TASK_ID } from "../../sample/studio";
import { TASK_BRANCH } from "../../sample/worktree";

/** The branch has no remote branch yet, so Push shows no count. */
export const COUNTS = {
  before: { ahead: 3, behind: 2, push: 0 },
  after: { ahead: 3, behind: 0, push: 0 },
} as const satisfies Record<string, GitCounts>;

/** The tooltip of Rebase onto target in git-info-header-state.ts and git-info-header.tsx. */
export const REBASE_TIP = `Rebase onto target (${COUNTS.before.behind} behind): ${TARGET_BRANCH}`;

export const CONFLICT_FILES = ["src/app/keymap.ts"] as const;

export const GIT_OUTPUT = [
  "Auto-merging src/app/keymap.ts",
  "CONFLICT (content): Merge conflict in src/app/keymap.ts",
  "error: could not apply 4c1e2f7... feat(search): open search with Cmd+K",
].join("\n");

/** The conflict steps of the Builder, copied from GIT_CONFLICT_INSTRUCTIONS. */
export const CONFLICT_INSTRUCTIONS = [
  "Resolve the conflicts below and finish the interrupted git operation.",
  "Before editing, inspect the live git state and relevant history. Understand the intent of both sides, preserve compatible changes, and avoid unrelated edits.",
  "Make only the changes needed to resolve the conflicts, then run the relevant checks. If you cannot finish safely, explain the blocker and stop. Do not abort the git operation unless explicitly asked.",
  "When finished, summarize what you resolved and which checks passed.",
].join("\n\n");

/** The message that Resolve conflicts sends: messages.build_git_conflict with its values. */
export const CONFLICT_MESSAGE = [
  CONFLICT_INSTRUCTIONS,
  [
    "Git context:",
    "- Operation: rebase",
    `- Current branch: ${TASK_BRANCH}`,
    `- Target branch: ${TARGET_BRANCH}`,
    "- Conflicted files:",
    ...CONFLICT_FILES.map((path) => `  - ${path}`),
  ].join("\n"),
  `Use taskId ${TASK_ID} for any task-bound odt_* tool calls.`,
].join("\n\n");

/** The Builder rows that resolve the conflict, in order. The ids differ from the rows of the build. */
export const ROWS = {
  "conflict-status": { args: "git status", duration: "0.2s", time: "10:14:09 AM" },
  "conflict-read": { args: "src/app/keymap.ts", duration: "9ms", time: "10:14:12 AM" },
  "conflict-test": { args: "bun test src/app src/search", duration: "2.6s", time: "10:14:40 AM" },
  "conflict-rebase": {
    args: "git add src/app/keymap.ts && GIT_EDITOR=true git rebase --continue",
    duration: "0.4s",
    time: "10:14:46 AM",
  },
} as const;

export const MESSAGE_TIME = "10:14:05 AM";

/** The final reply of the Builder. */
export const FINAL =
  "I resolved the conflict in `src/app/keymap.ts`. The target branch added a binding for `Cmd+P`, and this branch added `Cmd+K`, so I kept both. The tests pass, and the rebase is complete.";

/** The templates of the view: the conflict strip and the two dialogs. */
export type GitConflictTemplate = "strip" | "conflict-dialog" | "start-dialog";
