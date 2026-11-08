// The sample data of the workflow scene: the chapters, the questions of the Spec agent, and the
// files of the review.
import type { GitFile } from "../../replicas/studio/model";
import type { Question } from "../../replicas/transcript/model";
import { HOOK_PATH, REVIEWED_FILES } from "../../sample/studio";

/** The workflow steps: the tab label, the step text, and the text alternative of the view. */
export const CHAPTERS = [
  {
    id: "spec",
    label: "Spec",
    text: "The Spec agent reads the task and asks you what it needs to know. Then it writes the specification.",
    alt: "The session page of a task. The Spec agent asks which shortcut opens search and whether it works in text fields. While it waits, its session moves to Needs you in the sidebar. After the answers, it saves the specification in the Document tab.",
  },
  {
    id: "plan",
    label: "Plan",
    text: "The Planner reads the spec and the code, and designs the change: a diagram of the flow, the modules and their contracts, and the requirement coverage.",
    alt: "The session page of a task. The Planner reads the spec and three source files, then saves an implementation plan with a flow diagram, a table of the changed modules, the contract of the new hook, and a table that maps each requirement to the design.",
  },
  {
    id: "build",
    label: "Build",
    text: "The Builder works in a Git worktree for this task. When the runtime asks, you approve a command once or for the session. Then the Builder commits.",
    alt: "The session page of a task. The Builder edits four files in the task worktree and runs the tests. It asks to run git commit, and you approve it for the session. The Builder commits, and the Diffs tab lists the four changed files and one commit to push.",
  },
  {
    id: "qa",
    label: "QA",
    text: "The QA agent checks the change against the spec and the plan. If it rejects the change, the Builder gets the QA report and fixes the cause.",
    alt: "The session page of a task. You click Request QA Review and start a fresh QA session. The QA agent finds that the shortcut opens search over another dialog, and its report gives the finding and the checks in tables. You click Address QA Feedbacks and reuse the Builder session. The Builder adds the missing check and a test, then commits the fix.",
  },
  {
    id: "review",
    label: "Review",
    text: "You comment on diff lines, and the Builder fixes them. Then you merge directly, or the Builder opens the pull request and waits for its checks.",
    alt: "The session page of a task. QA approved the second build. You comment on line 10 of the diff and send the comment to the Builder, which fixes the line and commits. The Builder opens pull request 42 and waits until its checks pass. When the pull request merges, the task closes and leaves the sidebar.",
  },
] as const;

export type ChapterId = (typeof CHAPTERS)[number]["id"];

/** The questions of the Spec agent, with the answers that you pick. */
export const SPEC_QUESTIONS: readonly Question[] = [
  {
    header: "Shortcut",
    question: "Which shortcut opens search?",
    options: [
      {
        label: "Cmd+K / Ctrl+K",
        description: "Common in editors and chat apps. Free in Fieldnotes.",
      },
      {
        label: "Cmd+/ / Ctrl+/",
        description: "Free, but some keyboard layouts need Shift for /.",
      },
    ],
    answer: "Cmd+K / Ctrl+K",
  },
  {
    header: "Text fields",
    question: "Should the shortcut work while typing in a text field?",
    options: [
      {
        label: "No, ignore it in text fields",
        description: "The note editor keeps Cmd+K for links.",
      },
      { label: "Yes, everywhere", description: "Search opens even while you type a note." },
    ],
    answer: "No, ignore it in text fields",
  },
];

/** The files of the review, with the hook open on its diff. */
export const REVIEW_FILES: readonly GitFile[] = REVIEWED_FILES.map((file) =>
  file.path === HOOK_PATH ? { ...file, open: true } : file,
);
