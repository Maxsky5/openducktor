/** The workflow steps: the tab label, the text of the step, and the text alternative of its view. */
export const CHAPTERS = [
  {
    id: "spec",
    label: "Spec",
    text: "The Spec agent reads the task and asks you what it needs to know. Then it writes the specification.",
    alt: "Agent Studio. The Spec agent asks which shortcut opens search and whether it works in text fields. After the answers, it saves the specification in the document panel.",
  },
  {
    id: "plan",
    label: "Plan",
    text: "The Planner reads the spec and the code. It writes an implementation plan with the files to change and the tests to add.",
    alt: "Agent Studio. The Planner reads the spec and three source files, then saves an implementation plan that lists the files to change and the tests to add.",
  },
  {
    id: "build",
    label: "Build",
    text: "The Builder works in a Git worktree for this task. When the runtime asks, you approve a command once or for the session. Then the Builder commits.",
    alt: "Agent Studio. The Builder edits four files in the task worktree and runs the tests. It asks to run git commit, and you approve it for the session. The Builder commits, and the Git panel lists the four changed files and one commit to push.",
  },
  {
    id: "qa",
    label: "QA",
    text: "The QA agent checks the change against the spec and the plan. If it rejects the change, the Builder gets the QA report and fixes the cause.",
    alt: "Agent Studio. You click Request QA Review and start a fresh QA session. The QA agent finds that the shortcut opens search over another dialog and rejects the change. You click Address QA Feedbacks and reuse the Builder session. The Builder adds the missing check and a test, then commits the fix.",
  },
  {
    id: "review",
    label: "Review",
    text: "You comment on diff lines, and the Builder fixes them. Then you merge directly, or the Builder opens the pull request and waits for its checks.",
    alt: "Agent Studio. QA approved the second build. You comment on line 10 of the diff and send the comment to the Builder, which fixes the line and commits. The Builder opens pull request 42 and waits until its checks pass. When the pull request merges, the task closes.",
  },
] as const;

export type ChapterId = (typeof CHAPTERS)[number]["id"];
