// The sample data of the approve-merged scene. QA approved the Markdown import, and the task waits
// in Human Review. Sam merged its branch into main on the command line and pushed it. A merge
// detection pass of the host found the merge, so the card shows Merged and leads with Close Task,
// as getTaskFooter in packages/frontend-core gives it. The close removes the worktree and the
// branch, as the setting gives it. src/copied-approve-merged.test.ts compares the copies with the
// app. The PDF export waits for its approval with an open pull request.
import type { BoardData } from "../../replicas/board/model";
import { type Notification, workflowNotification } from "../../replicas/vocabulary";
import { TASKS } from "../../sample/tasks";
import { taskId } from "../../sample/workspace";

/** The task whose branch is merged. */
const TASK = "c7v2" as const;

/** The title and the ID of the task. */
export const TASK_IDENTITY = { title: TASKS[TASK].title, id: taskId(TASK) } as const;

/** The target branch of the task, as canonicalTargetBranch writes it. */
export const TARGET = "origin/main";

/** The tooltip of the Merged badge of kanban-task-card.tsx. */
export const MERGED_TIP = `Branch merged into ${TARGET}`;

/** The roles of the saved sessions of the task, which the card links. */
const LINKS = ["Builder", "QA"] as const;

/** The card of the task in Human Review: Merged, Close Task, and the links. */
export const MERGED_CARD = {
  name: "import",
  task: TASK,
  action: "Close Task",
  merged: true,
  links: LINKS,
} as const;

/**
 * The board of the first frame: the merged task leads Human Review. The board orders a lane by the
 * last update of each task, so the closed task goes to the end of Done.
 */
export const BOARD: BoardData = {
  human_review: [
    MERGED_CARD,
    { name: "pdf", task: "q7d1", action: "Approve Task", pr: 63, links: LINKS },
  ],
  closed: [{ name: "count", task: "n2r6" }],
};

/** The card of the closed task in Done: a closed task has no Merged badge and no actions. */
export const DONE_CARD = { name: "import", task: TASK } as const;

/** The success toast of closeTask, which removes the worktree and the local branch. */
export const CLOSED_FEEDBACK = {
  title: "Task closed",
  description: `${TASK_IDENTITY.id}. Its worktree and local branch were removed.`,
} as const;

/** The in-app notification of the Done state. */
export const CLOSED_NOTIFICATION: Notification = workflowNotification(
  "closed",
  TASK_IDENTITY.title,
);

/** The templates of the view. */
export type ApproveMergedTemplate = "done-card" | "toast-feedback" | "toast-closed";
