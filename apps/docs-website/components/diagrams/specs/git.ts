import {
  CircleCheck,
  Copy,
  FolderGit2,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Globe,
  Laptop,
  ListChecks,
  LogIn,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { chainDiagram } from "../chain";
import { defineDiagram } from "../define";
import type { EdgeOptions } from "../spec";

/**
 * The folders and branches of a task, with their default paths: the first session creates a
 * worktree next to your checkout, and the approval merges its branch into the target branch.
 */
export const worktree = chainDiagram({
  name: "worktree",
  label:
    "Your checkout is your repository folder, and it does not change. The first session of a task creates the task worktree, a second folder at ~/.openducktor/worktrees, then the workspace, then the task. It is on the task branch, odt/ then the task ID and a short form of the title. A direct merge or a pull request merges the task branch into the target branch, by default the default branch of the repository, such as origin/main.",
  steps: [
    {
      id: "checkout",
      title: "Your checkout",
      text: "Your repository folder. It does not change.",
      Icon: Laptop,
      narrowHeight: 64,
      next: { label: "Creates" },
    },
    {
      id: "worktree",
      title: "Task worktree",
      text: "A second folder of the repository, on the task branch",
      values: [
        { label: "Folder", value: "~/.openducktor/worktrees/<workspace>/<task>" },
        { label: "Branch", value: "odt/<task>-<title>" },
      ],
      Icon: FolderGit2,
      tone: "system",
      flex: 2.8,
      narrowHeight: 124,
      next: { label: "Merges into" },
    },
    {
      id: "target",
      title: "Target branch",
      text: "The branch that the work merges into",
      values: [{ label: "Default", value: "origin/main" }],
      Icon: GitBranch,
      flex: 1.3,
      narrowHeight: 84,
    },
  ],
  heights: { wide: 104, narrow: 84 },
  edge: { still: true },
});

const still = { still: true };
const turn = { still: true, step: true };

/** The three choices of Approve Task and how each one reaches Done. */
export const approval = defineDiagram({
  name: "approval",
  label:
    "Approve Task in AI Review or Human Review offers three choices. Direct merge: Merge locally. With a remote, then Push main and mark done. Without a remote, the task moves to Done at once. Pull request: the Builder or you write it; when the pull request merges on the Git provider, the task moves to Done at the next pull request check. Close task: merges no code, and the task moves to Done.",
  nodes: {
    approve: {
      type: "item",
      data: {
        title: "Approve Task",
        text: "In AI Review or Human Review",
        Icon: ShieldCheck,
        tone: "system",
      },
    },
    merge: { type: "item", data: { title: "Direct merge", text: "Merge locally", Icon: GitMerge } },
    push: {
      type: "item",
      data: {
        title: "Local merge ready",
        text: "With a remote: Push main and mark done",
        Icon: Upload,
      },
    },
    mergeDone: {
      type: "item",
      data: { title: "Done", text: "When you finish the merge", Icon: CircleCheck, tone: "result" },
    },
    pr: {
      type: "item",
      data: { title: "Pull request", text: "Builder or you write it", Icon: GitPullRequest },
    },
    prMerge: {
      type: "item",
      data: { title: "Pull request merges", text: "On the Git provider", Icon: GitMerge },
    },
    prDone: {
      type: "item",
      data: {
        title: "Done",
        text: "At the next pull request check",
        Icon: CircleCheck,
        tone: "result",
      },
    },
    close: { type: "item", data: { title: "Close task", text: "Merges no code", Icon: X } },
    closeDone: {
      type: "item",
      data: { title: "Done", text: "No code merged", Icon: CircleCheck, tone: "result" },
    },
  },
  // Desktop: the approval on the left, one row for each choice.
  wide: {
    width: 860,
    height: 266,
    boxes: {
      approve: { x: 1, y: 95, w: 160, h: 76 },
      merge: { x: 214, y: 1, w: 180, h: 64 },
      push: { x: 446, y: 1, w: 180, h: 64 },
      mergeDone: { x: 678, y: 1, w: 180, h: 64 },
      pr: { x: 214, y: 101, w: 180, h: 64 },
      prMerge: { x: 446, y: 101, w: 180, h: 64 },
      prDone: { x: 678, y: 101, w: 180, h: 64 },
      close: { x: 214, y: 201, w: 180, h: 64 },
      closeDone: { x: 678, y: 201, w: 180, h: 64 },
    },
    ports: {
      approve: [
        { id: "o1", side: "right", at: 18 },
        { id: "o2", side: "right", at: 38 },
        { id: "o3", side: "right", at: 58 },
      ],
    },
    edges: [
      ["approve.o1", "merge.l", turn],
      ["approve.o2", "pr.l", turn],
      ["approve.o3", "close.l", turn],
      ["merge.r", "push.l", still],
      ["push.r", "mergeDone.l", still],
      ["pr.r", "prMerge.l", still],
      ["prMerge.r", "prDone.l", still],
      ["close.r", "closeDone.l", still],
    ],
  },
  // Phone: the approval on top, then each choice with its result beside it.
  narrow: {
    width: 320,
    height: 392,
    boxes: {
      approve: { x: 0, y: 0, w: 320, h: 64 },
      merge: { x: 30, y: 116, w: 136, h: 64 },
      push: null,
      mergeDone: { x: 182, y: 116, w: 138, h: 64 },
      pr: { x: 30, y: 222, w: 136, h: 64 },
      prMerge: null,
      prDone: { x: 182, y: 222, w: 138, h: 64 },
      close: { x: 30, y: 328, w: 136, h: 64 },
      closeDone: { x: 182, y: 328, w: 138, h: 64 },
    },
    ports: { approve: [{ id: "trunk", side: "bottom", at: 14 }] },
    data: { mergeDone: { text: "After the merge" }, prDone: { text: "When it merges" } },
    edges: [
      ["approve.trunk", "merge.l", { ...turn, offset: 4 }],
      ["approve.trunk", "pr.l", { ...turn, offset: 4 }],
      ["approve.trunk", "close.l", { ...turn, offset: 4 }],
      ["merge.r", "mergeDone.l", still],
      ["pr.r", "prDone.l", still],
      ["close.r", "closeDone.l", still],
    ],
  },
});

const FAILED: EdgeOptions = { label: "A check fails", kind: "reject", step: true, offset: 26 };

/** A pull request from Approve Task to the closed task. */
export const pullRequest = defineDiagram({
  name: "pull-request",
  label:
    "The pull request flow. In Approve Task, choose Pull request, then Ask Builder, and start the session. The Builder pushes the task branch and opens or updates the pull request. The CI checks run, and the Builder waits until they pass. When a check fails, the Builder fixes it and pushes again. When every check passes, you merge the pull request on GitHub, GitLab, or Azure DevOps. OpenDucktor detects the merge every 5 minutes, or when you run Sync pull requests. Then the task closes and moves to Done, and cleanup runs.",
  nodes: {
    approve: {
      type: "item",
      data: {
        title: "Approve Task",
        text: "Pull request, then Ask Builder",
        Icon: ShieldCheck,
        tone: "system",
      },
    },
    publish: {
      type: "item",
      data: {
        title: "Builder publishes",
        text: "Pushes the branch, opens or updates the pull request",
        Icon: GitPullRequest,
      },
    },
    checks: {
      type: "item",
      data: { title: "CI checks run", text: "The Builder waits until they pass", Icon: ListChecks },
    },
    merge: {
      type: "item",
      data: { title: "You merge", text: "On GitHub, GitLab, or Azure DevOps", Icon: GitMerge },
    },
    detect: {
      type: "item",
      data: {
        title: "Merge detected",
        text: "Every 5 minutes, or Sync pull requests",
        Icon: RefreshCw,
      },
    },
    done: {
      type: "item",
      data: {
        title: "Done",
        text: "The task closes, and cleanup runs",
        Icon: CircleCheck,
        tone: "result",
      },
    },
  },
  // Desktop: the work of the Builder in the top row, and the merge in the bottom row. A failed
  // check goes back to the Builder over the top row.
  wide: {
    width: 860,
    height: 289,
    boxes: {
      approve: { x: 1, y: 44, w: 180, h: 72 },
      publish: { x: 340, y: 44, w: 180, h: 72 },
      checks: { x: 679, y: 44, w: 180, h: 72 },
      merge: { x: 1, y: 216, w: 180, h: 72 },
      detect: { x: 340, y: 216, w: 180, h: 72 },
      done: { x: 679, y: 216, w: 180, h: 72 },
    },
    edges: [
      ["approve.r", "publish.l", { label: "Start session" }],
      ["publish.r", "checks.l", { label: "Push" }],
      ["checks.t", "publish.t", FAILED],
      ["checks.b", "merge.t", { label: "Every check passes", step: true }],
      ["merge.r", "detect.l"],
      ["detect.r", "done.l", { label: "Closes the task" }],
    ],
  },
  // Phone: the steps in one column. A failed check goes back on the right.
  narrow: {
    width: 320,
    height: 634,
    boxes: {
      approve: { x: 0, y: 0, w: 270, h: 64 },
      publish: { x: 0, y: 114, w: 270, h: 64 },
      checks: { x: 0, y: 228, w: 270, h: 64 },
      merge: { x: 0, y: 342, w: 270, h: 64 },
      detect: { x: 0, y: 456, w: 270, h: 64 },
      done: { x: 0, y: 570, w: 270, h: 64 },
    },
    edges: [
      ["approve.b", "publish.t", { label: "Start session" }],
      ["publish.b", "checks.t", { label: "Push" }],
      ["checks.r", "publish.r", FAILED],
      ["checks.b", "merge.t", { label: "Every check passes" }],
      ["merge.b", "detect.t"],
      ["detect.b", "done.t", { label: "Closes the task" }],
    ],
  },
});

/**
 * The browser sign-in of GitLab.com: the card shows a one-time code, you approve it in the browser,
 * and OpenDucktor saves the token in the secure store of the system.
 */
export const gitlabSignIn = chainDiagram({
  name: "sign-in-gitlab",
  label:
    "GitLab.com sign-in has four steps. You select Sign in with GitLab in the Account step. The card shows a one-time code. You select Open GitLab sign-in, and the GitLab.com page already has the code. You approve. OpenDucktor saves the token in the secure store, and renews it.",
  steps: [
    {
      id: "start",
      title: "Sign in with GitLab",
      text: "Select it in the Account step",
      Icon: LogIn,
    },
    { id: "code", title: "One-time code", text: "The card shows a code", Icon: Copy },
    {
      id: "browser",
      title: "GitLab.com",
      text: "Open GitLab sign-in. The page has the code. Approve.",
      Icon: Globe,
    },
    {
      id: "saved",
      title: "Connected",
      text: "OpenDucktor saves the token and renews it",
      Icon: ShieldCheck,
      tone: "result",
    },
  ],
  heights: { wide: 104, narrow: 76 },
  edge: still,
});

/** The browser sign-in of Microsoft Entra, as for GitLab.com, but you type the code. */
export const microsoftSignIn = chainDiagram({
  name: "sign-in-microsoft",
  label:
    "Microsoft sign-in has four steps. You select Sign in with Microsoft in the Connection step. The card shows a one-time code, and you copy it. On the Microsoft sign-in page, you type the code, choose your work or school account, and approve. OpenDucktor saves the sign-in for this repository in the secure store.",
  steps: [
    {
      id: "start",
      title: "Sign in with Microsoft",
      text: "Select it in the Connection step",
      Icon: LogIn,
    },
    { id: "code", title: "One-time code", text: "The card shows a code. Copy it.", Icon: Copy },
    {
      id: "browser",
      title: "Microsoft sign-in",
      text: "Type the code, choose your work or school account, and approve",
      Icon: Globe,
    },
    {
      id: "saved",
      title: "Connected",
      text: "OpenDucktor saves the sign-in for this repository",
      Icon: ShieldCheck,
      tone: "result",
    },
  ],
  heights: { wide: 104, narrow: 76 },
  edge: still,
});
