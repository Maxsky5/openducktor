// The sample data of the Approve scene of the mobile app. QA approved the search shortcut task, so
// the task waits in Human Review. Its Builder session is open. The repository has a Git provider
// that creates pull requests, so the quick actions offer Generate Pull Request, and the approval
// opens on Pull request. The quick actions come from buildAgentStudioQuickActions in
// packages/frontend-core for a task in Human Review with a Builder session. The suggested squash
// message is the message of the oldest commit of the task branch. The commit, the remote, and the
// times are fictional.
import type { RailStep } from "../../replicas/mobile/MobileRail";
import type { MenuItem } from "../../replicas/mobile/QuickActionsMenu";
import type { MobileTool } from "../../replicas/mobile/TranscriptRows";
import type { RoleId } from "../../replicas/vocabulary";
import { TASKS } from "../../sample/tasks";
import {
  CircleCheckBig,
  GitPullRequest,
  RotateCcw,
  SquareArrowOutUpRight,
  Undo2,
} from "lucide-react";

export const TASK = "k3x9" as const;
export const TITLE = TASKS[TASK].title;

/** The steps of the step list, one for each part of the scene. */
export const STEPS = [
  "Open the Builder session of a task in Human Review.",
  "Tap the zap button, then Approve Task.",
  "The sheet opens on Pull request. Tap Direct merge, then Squash.",
  "Check the squash commit message. Then tap Merge locally.",
  "Tap Push main and mark done. The task moves to Done.",
] as const;

/** The quick actions of the task, in the order of the menu. */
export const QUICK_ACTIONS: readonly MenuItem[] = [
  { id: "quick:pull_request", title: "Generate Pull Request", icon: { Icon: GitPullRequest } },
  { id: "task:human_request_changes", title: "Request Changes", icon: { Icon: Undo2 } },
  { id: "quick:qa_review", title: "Request QA Review", icon: { role: "qa" } },
  {
    id: "quick:build_implementation_start",
    title: "Start Implementation",
    icon: { role: "build" },
  },
  { id: "quick:spec_initial", title: "Start Spec", icon: { role: "spec" } },
  { id: "quick:planner_initial", title: "Start Planner", icon: { role: "planner" } },
  { id: "task:human_approve", title: "Approve Task", icon: { Icon: CircleCheckBig } },
  { id: "task:open_builder", title: "Open Builder", icon: { Icon: SquareArrowOutUpRight } },
  {
    id: "task:reset_implementation",
    title: "Reset Implementation",
    icon: { Icon: RotateCcw },
    destructive: true,
  },
];

/** The item of the menu that opens the approval. */
export const APPROVE_ITEM = "task:human_approve";

/** The target branch of the task and the remote branch that the push updates. */
export const BRANCH = "main";
export const REMOTE_BRANCH = "origin/main";

/** The message of the oldest commit of the task branch. */
export const SQUASH_MESSAGE = "feat: open search with a keyboard shortcut";

/** taskApprovalSquashCommitHint for the target branch. */
export const SQUASH_HINT = {
  before: "Edit this message before combining the branch changes into one commit on ",
  code: BRANCH,
  after: ".",
} as const;

/** The merged commit that the push publishes, and the push destination of the remote. */
export const MERGED_COMMIT = "3f9c2a7d1e04b58c6a9f0e2d7b4c1a8e5f3d9c6b";
export const DESTINATIONS = ["github.com:sam/fieldnotes.git"] as const;

/** The toast of a completed direct merge: the message and the remote branch. */
export const DONE = { message: "Task moved to Done", description: REMOTE_BRANCH } as const;

/** The last tool calls of the Builder before the review. */
export const TOOLS = {
  test: {
    type: "bash",
    name: "bash",
    summary: "bun test src/search",
    duration: "2.4s",
    time: "10:12:08 AM",
  },
  lint: {
    type: "bash",
    name: "bash",
    summary: "bun run lint",
    duration: "3.8s",
    time: "10:12:15 AM",
  },
  commit: {
    type: "bash",
    name: "bash",
    summary: 'git commit -m "fix: keep focus in the search field"',
    duration: "0.3s",
    time: "10:12:21 AM",
  },
} as const satisfies Record<string, MobileTool>;

/** The last reply of the Builder, after its fix for the QA review. */
export const SUMMARY =
  "The search field keeps the focus now. `bun test src/search` and `bun run lint` pass, and the fix is committed.";

/** The workflow rail of a task in Human Review: every step is done. */
export const RAIL = {
  spec: { tone: "done", mark: "done" },
  planner: { tone: "done", mark: "done" },
  build: { tone: "done", mark: "done" },
  qa: { tone: "done", mark: "done" },
} as const satisfies Record<RoleId, RailStep>;
