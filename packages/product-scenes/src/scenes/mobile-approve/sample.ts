// The sample data of the Approve scene of the mobile app. QA approved the search shortcut task, so
// the task waits in Human Review. Its Builder session is open, with the session of
// sample/mobile-review.ts. The repository has a Git provider that creates pull requests, so the
// quick actions offer Generate Pull Request, and the approval opens on Pull request. The commit,
// the remote, and the times are fictional.
import { TASKS } from "../../sample/tasks";

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

/** The target branch of the task and the remote branch that the push updates. */
export const BRANCH = "main";
export const REMOTE_BRANCH = "origin/main";

/** The merged commit that the push publishes, and the push destination of the remote. */
export const MERGED_COMMIT = "3f9c2a7d1e04b58c6a9f0e2d7b4c1a8e5f3d9c6b";
export const DESTINATIONS = ["github.com:sam/fieldnotes.git"] as const;

/** The toast of a completed direct merge: the message and the remote branch. */
export const DONE = { message: "Task moved to Done", description: REMOTE_BRANCH } as const;
